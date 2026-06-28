using System.Net;
using System.Text.RegularExpressions;

static class LinkPreviewHelper
{
    private static readonly Regex MetaTagRegex = new(
        "<meta\\s+(?<attrs>[^>]*?)>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex LinkTagRegex = new(
        "<link\\s+(?<attrs>[^>]*?)>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static bool TryNormalizeExternalUrl(string? url, out Uri normalizedUrl)
    {
        normalizedUrl = null!;
        if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri))
        {
            return false;
        }

        if (uri.Scheme is not "http" and not "https")
        {
            return false;
        }

        if (uri.IsLoopback || uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        if (uri.Host.EndsWith(".local", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        normalizedUrl = uri;
        return true;
    }

    public static string? ExtractMetaContent(string html, string propertyName)
    {
        foreach (Match match in MetaTagRegex.Matches(html))
        {
            var attrs = match.Groups["attrs"].Value;
            if (!MetaAttributeMatches(attrs, "property", propertyName)
                && !MetaAttributeMatches(attrs, "name", propertyName))
            {
                continue;
            }

            var content = ReadMetaAttribute(attrs, "content");
            if (!string.IsNullOrWhiteSpace(content))
            {
                return WebUtility.HtmlDecode(content.Trim());
            }
        }

        return null;
    }

    public static string? ExtractLinkHref(string html, string relValue)
    {
        foreach (Match match in LinkTagRegex.Matches(html))
        {
            var attrs = match.Groups["attrs"].Value;
            if (!MetaAttributeMatches(attrs, "rel", relValue))
            {
                continue;
            }

            var href = ReadMetaAttribute(attrs, "href");
            if (!string.IsNullOrWhiteSpace(href))
            {
                return WebUtility.HtmlDecode(href.Trim());
            }
        }

        return null;
    }

    public static string? ResolveResourceUrl(Uri pageUrl, string? resourceUrl)
    {
        if (string.IsNullOrWhiteSpace(resourceUrl))
        {
            return null;
        }

        var trimmed = WebUtility.HtmlDecode(resourceUrl.Trim());
        if (trimmed.StartsWith("//", StringComparison.Ordinal))
        {
            return $"{pageUrl.Scheme}:{trimmed}";
        }

        if (Uri.TryCreate(trimmed, UriKind.Absolute, out var absolute)
            && absolute.Scheme is "http" or "https")
        {
            return absolute.ToString();
        }

        if (Uri.TryCreate(pageUrl, trimmed, out var resolved)
            && resolved.Scheme is "http" or "https")
        {
            return resolved.ToString();
        }

        return null;
    }

    private static bool MetaAttributeMatches(string attrs, string attributeName, string expectedValue)
    {
        var value = ReadMetaAttribute(attrs, attributeName);
        return value.Equals(expectedValue, StringComparison.OrdinalIgnoreCase);
    }

    private static string ReadMetaAttribute(string attrs, string attributeName)
    {
        var pattern = $"{attributeName}\\s*=\\s*(?:\"(?<value>[^\"]*)\"|'(?<value>[^']*)'|(?<value>[^\\s>]+))";
        var match = Regex.Match(attrs, pattern, RegexOptions.IgnoreCase);
        return match.Success ? match.Groups["value"].Value.Trim() : string.Empty;
    }
}
