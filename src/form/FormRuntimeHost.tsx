/**
 * FormRuntimeHost：一个 FormInstance 一份的联动运行作用域。
 *
 * 职责边界（见统一运行契约 §2/§4）：
 * - 登记字段级 linkage / events 配置；
 * - 用户交互后派发 events 与**非 immediate** 的 linkage；
 * - 派发顺序固定：Form Store 写入 → events → linkage；
 * - 写入不再隐式触发下一轮联动，避免循环。
 *
 * 变更来源：antd 的 `setFieldsValue` / `setFields` 走 `source: 'external'`，
 * 不会触发 `onValuesChange`，因此**不能**靠它识别程序赋值（契约明确要求
 * 用显式标记，不依赖该偶然行为）。这里的来源划分是：
 * - 用户交互：SchemaField 的 onChange → dispatchUserChange，显式调用；
 * - 任意变更（含初始化、回填、setData）：immediate 规则由 SchemaFormField
 *   订阅自身依赖值变化后调用 runImmediateRulesOf，与来源无关。
 */
import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { FormInstance } from 'antd';

import { IS_DEV } from '../env';
import type { FieldEventContext, FormFieldSchema, LinkageRule, NamePath, WriteContext } from '../types';
import { namePathKey } from './namePath';

/** 依赖值没变却重复执行的容忍次数，超出视为规则成环 */
const MAX_IMMEDIATE_REPEATS = 3;

export class FormRuntimeHost {
  private readonly form: FormInstance;

  private readonly fields = new Map<string, FormFieldSchema>();

  /** 防止同一轮派发内被重入 */
  private dispatching = false;

  /** immediate 规则上次执行时的依赖值签名，键为 `${字段}#${规则序号}` */
  private readonly immediateSignatures = new Map<string, string>();

  /** 依赖值未变却重复执行的次数，用于发现跨字段成环 */
  private readonly immediateRepeats = new Map<string, number>();

  constructor(form: FormInstance) {
    this.form = form;
  }

  /** 返回注销函数；同名字段以最后一次登记为准 */
  registerField(schema: FormFieldSchema): () => void {
    const key = namePathKey(schema.name);
    this.fields.set(key, schema);
    return () => {
      if (this.fields.get(key) === schema) {
        this.fields.delete(key);
      }
    };
  }

  private createWriteContext(
    written: Map<string, unknown>,
    touched: Set<string>,
    skipUnchanged = false,
  ): WriteContext {
    const form = this.form;
    const track = (name: NamePath, value: unknown) => {
      const key = namePathKey(name);
      if (written.has(key) && written.get(key) !== value && IS_DEV) {
        console.warn(`[schema] 同一轮联动重复写入 "${key}"，结果依赖规则执行顺序，请合并规则`);
      }
      written.set(key, value);
      touched.add(key);
    };
    const set = (name: NamePath, value: unknown) => {
      track(name, value);
      // 仅优化 immediate 的纯标量赋值；对象、显式清空和错误清理保持原行为。
      if (skipUnchanged && value != null && typeof value !== 'object'
        && typeof value !== 'function' && Object.is(form.getFieldValue(name), value)
        && !form.isFieldValidating(name) && !form.getFieldError(name).length
        && !form.getFieldWarning(name).length) return;
      form.setFieldValue(name, value);
    };

    return {
      form,
      get: (name) => form.getFieldValue(name),
      getValues: () => form.getFieldsValue(true),
      set,
      // 批量写入：记账口径与 set 一致（按顶层键），写入合并成一次 Store 更新
      setValues: (values) => {
        const entries = Object.entries(values);
        for (const [key, value] of entries) track(key, value);
        if (!entries.length) return;
        form.setFieldsValue(values as never);
      },
      clear: (name) => set(name, undefined),
      clearValues: (names) => names.forEach((name) => set(name, undefined)),
    };
  }

  private runRule(ctx: WriteContext, rule: LinkageRule): void {
    rule.handler(ctx);
  }

  /** 依赖值签名：两次执行签名相同说明这次不是被依赖变化驱动的 */
  private dependencySignature(rule: LinkageRule): string | undefined {
    try {
      return JSON.stringify(rule.dependencies.map((dep) => this.form.getFieldValue(dep)));
    } catch {
      // 存在循环引用时放弃判定，宁可不拦也不误伤
      return undefined;
    }
  }

  /**
   * 用户交互后的派发入口。
   * 调用前必须保证新值已经写入 Form Store，否则 ctx.get() 会读到旧值。
   * immediate 规则不在这里执行：它们由依赖值订阅统一驱动，避免同一变更跑两遍。
   */
  dispatchUserChange(changed: FormFieldSchema, value: unknown, meta: unknown[]): void {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const written = new Map<string, unknown>();
      const ctx = this.createWriteContext(written, new Set());

      // 1. 当前字段的交互副作用
      if (changed.events?.onChange) {
        const eventCtx: FieldEventContext = { ...ctx, option: meta[0], meta };
        changed.events.onChange(value, eventCtx);
      }

      // 2. 依赖该字段的非 immediate linkage 规则
      const changedKey = namePathKey(changed.name);
      for (const field of this.fields.values()) {
        for (const rule of field.linkage ?? []) {
          if (rule.immediate) continue;
          if (rule.dependencies.some((dep) => namePathKey(dep) === changedKey)) {
            this.runRule(ctx, rule);
          }
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  /**
   * 执行某个字段声明的 immediate 规则。
   * 由 SchemaFormField 在依赖值变化时调用（含初始值、回填、setData），
   * 不区分变更来源。
   */
  runImmediateRulesOf(schema: FormFieldSchema): void {
    if (this.dispatching) return;
    const rules = (schema.linkage ?? []).filter((rule) => rule.immediate);
    if (!rules.length) return;

    this.dispatching = true;
    try {
      for (const rule of rules) {
        const ruleKey = `${namePathKey(schema.name)}#${schema.linkage?.indexOf(rule)}`;

        // 依赖值没变还在跑，说明是别的规则写回了依赖，继续跑下去就是成环
        const signature = this.dependencySignature(rule);
        const repeated =
          signature !== undefined && signature === this.immediateSignatures.get(ruleKey);
        const repeats = repeated ? (this.immediateRepeats.get(ruleKey) ?? 0) + 1 : 0;
        if (signature !== undefined) this.immediateSignatures.set(ruleKey, signature);
        this.immediateRepeats.set(ruleKey, repeats);
        if (repeats > MAX_IMMEDIATE_REPEATS) {
          if (IS_DEV) {
            console.error(
              `[schema] "${ruleKey}" 依赖值未变却重复执行 ${repeats} 次，判定为成环，已跳过`,
            );
          }
          continue;
        }

        const written = new Map<string, unknown>();
        const touched = new Set<string>();
        this.runRule(this.createWriteContext(written, touched, true), rule);

        // immediate 写回自己的依赖会形成渲染死循环，开发态直接指出来
        if (IS_DEV) {
          const depKeys = new Set(rule.dependencies.map((dep) => namePathKey(dep)));
          for (const key of touched) {
            if (depKeys.has(key)) {
              console.warn(`[schema] immediate 规则 "${ruleKey}" 写回了自己的依赖 "${key}"`);
            }
          }
        }
      }
    } finally {
      this.dispatching = false;
    }
  }
}

const FormRuntimeHostContext = createContext<FormRuntimeHost | null>(null);

export function FormRuntimeHostProvider({
  form,
  children,
}: {
  form: FormInstance;
  children: ReactNode;
}) {
  const host = useMemo(() => new FormRuntimeHost(form), [form]);
  return <FormRuntimeHostContext.Provider value={host}>{children}</FormRuntimeHostContext.Provider>;
}

/** 不在 Host 内时返回 null：字段照常渲染，只是没有联动派发 */
export function useFormRuntimeHost(): FormRuntimeHost | null {
  return useContext(FormRuntimeHostContext);
}
