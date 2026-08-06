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
    public DbSet<SupplyFboDefect> SupplyFboDefects => Set<SupplyFboDefect>();
    public DbSet<SupplyExpense> SupplyExpenses => Set<SupplyExpense>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<ChatGroup> ChatGroups => Set<ChatGroup>();
    public DbSet<ChatGroupMember> ChatGroupMembers => Set<ChatGroupMember>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<AppIntegrationSettings> AppIntegrationSettings => Set<AppIntegrationSettings>();
    public DbSet<RoleProfile> RoleProfiles => Set<RoleProfile>();
    public DbSet<SatuProduct> SatuProducts => Set<SatuProduct>();
    public DbSet<SatuSyncState> SatuSyncStates => Set<SatuSyncState>();
    public DbSet<SatuAnalyticsCacheEntry> SatuAnalyticsCacheEntries => Set<SatuAnalyticsCacheEntry>();
    public DbSet<ProductCostProfile> ProductCostProfiles => Set<ProductCostProfile>();
    public DbSet<ProductCostType> ProductCostTypes => Set<ProductCostType>();
    public DbSet<OzonCommissionSnapshot> OzonCommissionSnapshots => Set<OzonCommissionSnapshot>();
    public DbSet<OzonCategoryCommission> OzonCategoryCommissions => Set<OzonCategoryCommission>();
    public DbSet<OzonCommissionSyncState> OzonCommissionSyncStates => Set<OzonCommissionSyncState>();
    public DbSet<CalculatorSettings> CalculatorSettings => Set<CalculatorSettings>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OzonCommissionSnapshot>(entity =>
        {
            entity.HasKey(snapshot => snapshot.Id);
            entity.HasIndex(snapshot => snapshot.ProductId).IsUnique();
            entity.HasIndex(snapshot => snapshot.DescriptionCategoryId);
            entity.Property(snapshot => snapshot.OfferId).HasMaxLength(200);
            entity.Property(snapshot => snapshot.ProductName).HasMaxLength(500);
            entity.Property(snapshot => snapshot.CurrencyCode).HasMaxLength(16);
            // Сырой JSON может быть любой длины — колонка text, а не varchar.
            // Урок из миграции 0e1eb35 (падение старта из-за узкой ItemsJson).
            entity.Property(snapshot => snapshot.RawCommissionsJson).HasColumnType("text");
        });

        modelBuilder.Entity<OzonCategoryCommission>(entity =>
        {
            entity.HasKey(category => category.DescriptionCategoryId);
            entity.Property(category => category.DescriptionCategoryId).ValueGeneratedNever();
            entity.Property(category => category.CategoryName).HasMaxLength(500);
        });

        modelBuilder.Entity<OzonCommissionSyncState>(entity =>
        {
            entity.HasKey(state => state.Key);
            entity.Property(state => state.Key).HasMaxLength(64).ValueGeneratedNever();
            entity.Property(state => state.Status).HasMaxLength(32);
            entity.Property(state => state.ErrorMessage).HasMaxLength(2000);
        });

        modelBuilder.Entity<CalculatorSettings>(entity =>
        {
            entity.HasKey(settings => settings.Id);
            entity.Property(settings => settings.Id).ValueGeneratedNever();
            entity.Property(settings => settings.TaxMode).HasMaxLength(48);
            entity.Property(settings => settings.DefaultScheme).HasMaxLength(16);
        });

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
            entity.Property(user => user.TelegramNotifyEventsKz).HasMaxLength(4000);
            entity.Property(user => user.TelegramDailyReportTime).HasMaxLength(8);
            entity.Property(user => user.TelegramDailyReportTimezone).HasMaxLength(64);
            entity.Property(user => user.TelegramDailyReportSections).HasMaxLength(2000);
            entity.Property(user => user.TelegramMonthlyReportTime).HasMaxLength(8);
            entity.Property(user => user.TelegramMonthlyReportTimezone).HasMaxLength(64);
            entity.Property(user => user.TelegramMonthlyReportSections).HasMaxLength(2000);
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
            entity.HasIndex(file => file.ProductionTaskItemId);
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
            entity.Property(record => record.ItemsJson).HasColumnType("text");
        });

        modelBuilder.Entity<ProductionTask>(entity =>
        {
            entity.HasIndex(task => task.Status);
            entity.HasIndex(task => task.IsArchived);
            entity.HasIndex(task => task.DueAt);
            entity.HasIndex(task => task.OverdueNotifiedAt);
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
            entity.Property(item => item.PackedByDisplayName).HasMaxLength(160);
        });

        modelBuilder.Entity<Supply>(entity =>
        {
            entity.HasIndex(supply => supply.Status);
            entity.HasIndex(supply => supply.IsArchived);
            entity.Property(supply => supply.Status).HasMaxLength(32);
            entity.Property(supply => supply.ShippingCost).HasPrecision(18, 2);
            entity.HasMany(supply => supply.Items)
                .WithOne(item => item.Supply)
                .HasForeignKey(item => item.SupplyId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SupplyItem>(entity =>
        {
            entity.HasIndex(item => item.OfferId);
            entity.HasIndex(item => item.IsReserve);
            entity.HasIndex(item => item.ItemKind);
            entity.Property(item => item.OfferId).HasMaxLength(120);
            entity.Property(item => item.ProductName).HasMaxLength(240);
            entity.Property(item => item.ItemKind).HasMaxLength(32);
        });

        modelBuilder.Entity<SupplyFboDefect>(entity =>
        {
            entity.HasIndex(defect => defect.ProductKey).IsUnique();
            entity.Property(defect => defect.ProductKey).HasMaxLength(160);
            entity.Property(defect => defect.OfferId).HasMaxLength(120);
            entity.Property(defect => defect.ProductName).HasMaxLength(240);
            entity.HasOne(defect => defect.CreatedByUser)
                .WithMany()
                .HasForeignKey(defect => defect.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<SupplyExpense>(entity =>
        {
            entity.HasIndex(expense => expense.Name);
            entity.HasIndex(expense => expense.PurchasedAt);
            entity.HasIndex(expense => expense.CreatedAt);
            entity.Property(expense => expense.Name).HasMaxLength(240);
            entity.Property(expense => expense.Amount).HasPrecision(18, 2);
            entity.HasOne(expense => expense.CreatedByUser)
                .WithMany()
                .HasForeignKey(expense => expense.CreatedByUserId)
                .OnDelete(DeleteBehavior.Restrict);
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

        modelBuilder.Entity<SatuProduct>(entity =>
        {
            entity.HasIndex(product => new { product.ShopId, product.SatuProductId }).IsUnique();
            entity.HasIndex(product => product.ShopId);
            entity.HasIndex(product => product.IsActive);
            entity.HasIndex(product => product.Status);
            entity.HasIndex(product => product.CategoryId);
            entity.HasIndex(product => product.LastSyncedAt);
            entity.HasIndex(product => product.Name);
            entity.HasIndex(product => product.OfferId);
            entity.Property(product => product.ShopId).HasMaxLength(120);
            entity.Property(product => product.OfferId).HasMaxLength(120);
            entity.Property(product => product.Name).HasMaxLength(500);
            entity.Property(product => product.Description).HasColumnType("text");
            entity.Property(product => product.ImageUrlsJson).HasColumnType("text");
            entity.Property(product => product.RawJson).HasColumnType("text");
            entity.Property(product => product.Status).HasMaxLength(32);
            entity.Property(product => product.ProductUrl).HasMaxLength(500);
            entity.Property(product => product.ImageUrl).HasMaxLength(500);
            entity.Property(product => product.CurrencyCode).HasMaxLength(8);
            entity.Property(product => product.CategoryId).HasMaxLength(120);
        });

        modelBuilder.Entity<SatuSyncState>(entity =>
        {
            entity.HasKey(state => state.ShopId);
            entity.Property(state => state.ShopId).HasMaxLength(120);
            entity.Property(state => state.Status).HasMaxLength(32);
            entity.Property(state => state.ErrorMessage).HasMaxLength(2000);
        });

        modelBuilder.Entity<SatuAnalyticsCacheEntry>(entity =>
        {
            entity.HasKey(entry => entry.CacheKey);
            entity.HasIndex(entry => new { entry.ShopId, entry.PeriodFrom, entry.PeriodTo });
            entity.Property(entry => entry.CacheKey).HasMaxLength(200);
            entity.Property(entry => entry.ShopId).HasMaxLength(120);
            entity.Property(entry => entry.PayloadJson).HasColumnType("text");
        });

        modelBuilder.Entity<ProductCostProfile>(entity =>
        {
            entity.HasIndex(profile => new { profile.Marketplace, profile.ProductId }).IsUnique();
            entity.HasIndex(profile => new { profile.Marketplace, profile.OfferId });
            entity.HasIndex(profile => profile.CostTypeId);
            entity.Property(profile => profile.Marketplace).HasMaxLength(32);
            entity.Property(profile => profile.OfferId).HasMaxLength(120);
            entity.Property(profile => profile.ProductName).HasMaxLength(240);
            entity.Property(profile => profile.UseIndividualCost).HasDefaultValue(true);
            entity.Property(profile => profile.PurchaseCost).HasPrecision(18, 2);
            entity.Property(profile => profile.PackagingCost).HasPrecision(18, 2);
            entity.Property(profile => profile.ProductionCost).HasPrecision(18, 2);
            entity.HasOne(profile => profile.CostType)
                .WithMany()
                .HasForeignKey(profile => profile.CostTypeId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<ProductCostType>(entity =>
        {
            entity.HasIndex(type => new { type.Marketplace, type.Name }).IsUnique();
            entity.Property(type => type.Marketplace).HasMaxLength(32);
            entity.Property(type => type.Name).HasMaxLength(120);
            entity.Property(type => type.PurchaseCost).HasPrecision(18, 2);
            entity.Property(type => type.PackagingCost).HasPrecision(18, 2);
            entity.Property(type => type.ProductionCost).HasPrecision(18, 2);
        });
    }
}
