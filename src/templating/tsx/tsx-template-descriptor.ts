export interface TsxTemplateDescriptor<TData> {
    data: TData;
    getTemplate: (data: TData) => string | Promise<string>
}