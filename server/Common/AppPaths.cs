static class AppPaths
{
    public static string GetAvatarDirectory(IWebHostEnvironment environment) =>
        Path.GetFullPath(Path.Combine(environment.ContentRootPath, "user-avatars"));

    public static string GetBackupDirectory(IWebHostEnvironment environment)
    {
        var contentRootBackups = Path.Combine(environment.ContentRootPath, "backups");
        if (Directory.Exists(contentRootBackups))
        {
            return Path.GetFullPath(contentRootBackups);
        }

        var parent = Directory.GetParent(environment.ContentRootPath)?.FullName;
        return Path.GetFullPath(Path.Combine(parent ?? environment.ContentRootPath, "backups"));
    }
}


