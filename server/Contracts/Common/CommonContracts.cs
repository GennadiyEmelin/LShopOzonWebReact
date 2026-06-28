namespace LShopOzonWebReact.Api.Contracts.Common;

record AnalyticsExportRequest(string? SheetName, string? FileName, List<List<string>> Rows);

record LinkPreviewResponse(string? ImageUrl, string? Title);

record Product(int Id, string Name, string Status, decimal Price);
