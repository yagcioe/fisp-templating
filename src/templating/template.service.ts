import { TsxTemplateEngine } from "./tsx/tsx-template-engine.ts";
import type { TsxTemplateDescriptor } from "./tsx/tsx-template-descriptor.ts";
import type { TypstTemplateDescriptor } from "./typst/typst-template-descriptor.ts";
import { TypstTemplateEngine } from "./typst/typst-template-engine.ts";

export interface TemplateEngine {
    init?(): Promise<void>;
    render<TDescriptor>(data: TDescriptor, format: "pdf"): Promise<Uint8Array>;
    render<TDescriptor>(data: TDescriptor, format: "html"): Promise<string>;
    close?(): Promise<void>;
}

export type TemplateEngineName = keyof TemplateService["engines"];
export type TemplateEngineType<TName extends TemplateEngineName> = TemplateService["engines"][TName];

/**
 * Descriptor type each engine's `render` takes, for a concrete data type.
 * (`Parameters<…["render"]>` can't be used: `render` is generic, so TData would be `unknown`.)
 */
export type TemplateDescriptor<TName extends TemplateEngineName, TData> = {
    tsx: TsxTemplateDescriptor<TData>;
    typst: TypstTemplateDescriptor<TData>;
}[TName];

export class TemplateService {
    public readonly engines = {
        typst: new TypstTemplateEngine(),
        tsx: new TsxTemplateEngine(),
    } as const satisfies Record<string, TemplateEngine>;

    /** Engine names as a non-empty tuple, e.g. for `z.enum()`. */
    public get engineNames(): [TemplateEngineName, ...TemplateEngineName[]] {
        return Object.keys(this.engines) as [TemplateEngineName, ...TemplateEngineName[]];
    }

    public async init(): Promise<void> {
        await Promise.all(Object.values(this.engines).map((e) => e.init()));
    }

    public async close(): Promise<void> {
        await Promise.all(Object.values(this.engines).map((e) => e.close()));
    }
}