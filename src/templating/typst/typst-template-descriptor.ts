export interface TypstTemplateDescriptor<TData> {
    data: TData;
    getTemplate: () => string | Promise<string>
}