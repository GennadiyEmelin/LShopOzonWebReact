static class CsvExport
{
    public static string Cell(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
}


