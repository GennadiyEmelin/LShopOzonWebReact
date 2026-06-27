using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<ProductionFile> ProductionFiles => Set<ProductionFile>();
    public DbSet<ProductionFilePath> ProductionFilePaths => Set<ProductionFilePath>();
    public DbSet<ProductionAnalyticsTaskRecord> ProductionAnalyticsTaskRecords => Set<ProductionAnalyticsTaskRecord>();
    public DbSet<ProductionTask> ProductionTasks => Set<ProductionTask>();
    public DbSet<ProductionTaskItem> ProductionTaskItems => Set<ProductionTaskItem>();
    public DbSet<Supply> Supplies => Set<Supply>();
    public DbSet<SupplyItem> SupplyItems => Set<SupplyItem>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<ChatGroup> ChatGroups => Set<ChatGroup>();
    public DbSet<ChatGroupMember> ChatGroupMembers => Set<ChatGroupMember>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<AppIntegrationSettings> AppIntegrationSettings => Set<AppIntegrationSettings>();
    public DbSet<RoleProfile> RoleProfiles => Set<RoleProfile>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.HasIndex(user => user.UserName).IsUnique();
            entity.Property(user => user.UserName).HasMaxLength(80);
            entity.Property(user => user.DisplayName).HasMaxLength(160);
            entity.Property(user => user.Position).HasMaxLength(160);
            entity.Property(user => user.AvatarFileName).HasMaxLength(260);
            entity.Property(user => user.AllowedFeatures).HasMaxLength(2000);
            entity.Property(user => user.HomeBlocksJson).HasMaxLength(4000);
            entity.Property(user => user.Role).HasMaxLength(32);
            entity.Property(user => user.TelegramChatId).HasMaxLength(32);
            entity.Property(user => user.TelegramConnectToken).HasMaxLength(64);
            entity.Property(user => user.TelegramNotifyEvents).HasMaxLength(4000);
            entity.Property(user => user.TelegramDailyReportTime).HasMaxLength(8);
            entity.Property(user => user.TelegramDailyReportTimezone).HasMaxLength(64);
            entity.Property(user => user.TelegramDailyReportSections).HasMaxLength(2000);
        });

        modelBuilder.Entity<AppIntegrationSettings>(entity =>
        {
            entity.HasKey(settings => settings.Id);
            entity.Property(settings => settings.Id).ValueGeneratedNever();
            entity.Property(settings => settings.OzonClientId).HasMaxLength(120);
            entity.Property(settings => settings.OzonApiKey).HasMaxLength(240);
            entity.Property(settings => settings.OzonBaseUrl).HasMaxLength(240);
            entity.Property(settings => settings.KaspiMerchantId).HasMaxLength(120);
            entity.Property(settings => settings.KaspiApiKey).HasMaxLength(240);
            entity.Property(settings => settings.SatuMerchantId).HasMaxLength(120);
            entity.Property(settings => settings.SatuApiKey).HasMaxLength(240);
            entity.Property(settings => settings.HalykMerchantId).HasMaxLength(120);
            entity.Property(settings => settings.HalykApiKey).HasMaxLength(240);
        });

        modelBuilder.Entity<ProductionFile>(entity =>
        {
            entity.HasIndex(file => file.OfferId);
            entity.Property(file => file.OfferId).HasMaxLength(120);
            entity.Property(file => file.ProductName).HasMaxLength(240);
            entity.Property(file => file.ProductLink).HasMaxLength(500);
            entity.Property(file => file.FileName).HasMaxLength(260);
            entity.Property(file => file.ContentType).HasMaxLength(120);
        });

        modelBuilder.Entity<ProductionFilePath>(entity =>
        {
            entity.HasIndex(path => path.OfferId);
            entity.Property(path => path.OfferId).HasMaxLength(120);
            entity.Property(path => path.ProductName).HasMaxLength(240);
            entity.Property(path => path.ProductLink).HasMaxLength(500);
            entity.Property(path => path.Path).HasMaxLength(2000);
        });

        modelBuilder.Entity<ProductionAnalyticsTaskRecord>(entity =>
        {
            entity.HasIndex(record => record.SourceTaskId).IsUnique();
            entity.HasIndex(record => record.CompletedAt);
            entity.HasIndex(record => record.AssignedUserId);
            entity.Property(record => record.OfferId).HasMaxLength(120);
            entity.Property(record => record.ProductName).HasMaxLength(240);
            entity.Property(record => record.TaskType).HasMaxLength(32);
            entity.Property(record => record.AssignedUserName).HasMaxLength(80);
            entity.Property(record => record.CreatedByDisplayName).HasMaxLength(160);
            entity.Property(record => record.ItemsJson).HasMaxLength(8000);
        });

        modelBuilder.Entity<ProductionTask>(entity =>
        {
            entity.HasIndex(task => task.Status);
            entity.HasIndex(task => task.IsArchived);
            entity.Property(task => task.OfferId).HasMaxLength(120);
            entity.Property(task => task.ProductName).HasMaxLength(240);
            entity.Property(task => task.Status).HasMaxLength(32);
            entity.Property(task => task.AssignedUserName).HasMaxLength(80);
            entity.Property(task => task.CreatedByDisplayName).HasMaxLength(160);
            entity.Property(task => task.CancellationComment).HasMaxLength(2000);
            entity.Property(task => task.CancelledByDisplayName).HasMaxLength(160);
            entity.Property(task => task.TaskType).HasMaxLength(32);
            entity.HasMany(task => task.Items)
                .WithOne(item => item.ProductionTask)
                .HasForeignKey(item => item.ProductionTaskId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ProductionTaskItem>(entity =>
        {
            entity.HasIndex(item => item.OfferId);
            entity.Property(item => item.OfferId).HasMaxLength(120);
            entity.Property(item => item.ProductName).HasMaxLength(240);
            entity.Property(item => item.ProductLink).HasMaxLength(500);
            entity.Property(item => item.FilePath).HasMaxLength(2000);
        });

        modelBuilder.Entity<Supply>(entity =>
        {
            entity.HasIndex(supply => supply.Status);
            entity.HasIndex(supply => supply.IsArchived);
            entity.Property(supply => supply.Status).HasMaxLength(32);
            entity.HasMany(supply => supply.Items)
                .WithOne(item => item.Supply)
                .HasForeignKey(item => item.SupplyId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SupplyItem>(entity =>
        {
            entity.HasIndex(item => item.OfferId);
            entity.HasIndex(item => item.IsReserve);
            entity.Property(item => item.OfferId).HasMaxLength(120);
            entity.Property(item => item.ProductName).HasMaxLength(240);
        });

        modelBuilder.Entity<ChatGroup>(entity =>
        {
            entity.Property(group => group.Name).HasMaxLength(120);
            entity.HasIndex(group => group.CreatedAt);
            entity.HasOne(group => group.CreatedByUser)
                .WithMany()
                .HasForeignKey(group => group.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
            entity.HasMany(group => group.Members)
                .WithOne(member => member.Group)
                .HasForeignKey(member => member.GroupId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(group => group.Messages)
                .WithOne(message => message.Group)
                .HasForeignKey(message => message.GroupId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ChatGroupMember>(entity =>
        {
            entity.HasIndex(member => new { member.GroupId, member.UserId }).IsUnique();
            entity.HasOne(member => member.User)
                .WithMany()
                .HasForeignKey(member => member.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ChatMessage>(entity =>
        {
            entity.HasIndex(message => new { message.SenderId, message.ReceiverId, message.CreatedAt });
            entity.HasIndex(message => new { message.ReceiverId, message.SenderId, message.CreatedAt });
            entity.HasIndex(message => new { message.ReceiverId, message.ReadAt });
            entity.HasIndex(message => new { message.GroupId, message.CreatedAt });
            entity.Property(message => message.Text).HasMaxLength(2000);
            entity.Property(message => message.AttachmentFileName).HasMaxLength(260);
            entity.Property(message => message.AttachmentContentType).HasMaxLength(120);
            entity.HasOne(message => message.Sender)
                .WithMany()
                .HasForeignKey(message => message.SenderId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(message => message.Receiver)
                .WithMany()
                .HasForeignKey(message => message.ReceiverId)
                .OnDelete(DeleteBehavior.Cascade)
                .IsRequired(false);
        });

        modelBuilder.Entity<RoleProfile>(entity =>
        {
            entity.HasKey(profile => profile.Role);
            entity.Property(profile => profile.Role).HasMaxLength(32);
            entity.Property(profile => profile.DisplayName).HasMaxLength(80);
            entity.Property(profile => profile.AllowedFeatures).HasMaxLength(2000);
            entity.Property(profile => profile.HomeBlocksJson).HasMaxLength(4000);
        });

        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.HasIndex(log => log.CreatedAt);
            entity.HasIndex(log => log.Action);
            entity.HasIndex(log => log.EntityType);
            entity.HasIndex(log => log.UserName);
            entity.Property(log => log.UserName).HasMaxLength(80);
            entity.Property(log => log.DisplayName).HasMaxLength(160);
            entity.Property(log => log.Action).HasMaxLength(80);
            entity.Property(log => log.EntityType).HasMaxLength(80);
            entity.Property(log => log.EntityId).HasMaxLength(120);
            entity.Property(log => log.Details).HasMaxLength(2000);
        });
    }
}
