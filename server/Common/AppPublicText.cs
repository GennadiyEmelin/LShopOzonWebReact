static class AppPublicText
{
    public static string MaskSecret(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "не задан";
        }

        if (value.Length <= 6)
        {
            return new string('*', value.Length);
        }

        return $"{value[..3]}...{value[^3..]}";
    }

    public static string GetPublicOzonError(Exception exception)
    {
        var message = exception.Message;
        if (message.Length > 220)
        {
            message = $"{message[..220]}...";
        }

        return $"Ozon API не отвечает: {message}";
    }
}


