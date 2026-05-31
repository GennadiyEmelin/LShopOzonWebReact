using LShopOzonWebReact.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace LShopOzonWebReact.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<ProductionFile> ProductionFiles => Set<ProductionFile>();
    public DbSet<ProductionTask> ProductionTasks => Set<ProductionTask>();
    public DbSet<ProductionTaskItem> ProductionTaskItems => Set<ProductionTaskItem>();
    public DbSet<Supply> Supplies => Set<Supply>();
    public DbSet<SupplyItem> SupplyItems => Set<SupplyItem>();
    public DbSet<ChatMessage> ChatMessages => Set<ChatMessage>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.HasIndex(user => user.UserName).IsUnique();
            entity.Property(user => user.UserName).HasMaxLength(80);
            entity.Property(user => user.DisplayName).HasMaxLength(160);
            entity.Property(user => user.Role).HasMaxLength(32);
        });

        modelBuilder.Entity<ProductionFile>(entity =>
        {
            entity.HasIndex(file => file.OfferId);
            entity.Property(file => file.OfferId).HasMaxLength(120);
            entity.Property(file => file.ProductName).HasMaxLength(240);
            entity.Property(file => file.FileName).HasMaxLength(260);
            entity.Property(file => file.ContentType).HasMaxLength(120);
        });

        modelBuilder.Entity<ProductionTask>(entity =>
        {
            entity.HasIndex(task => task.Status);
            entity.HasIndex(task => task.IsArchived);
            entity.Property(task => task.OfferId).HasMaxLength(120);
            entity.Property(task => task.ProductName).HasMaxLength(240);
            entity.Property(task => task.Status).HasMaxLength(32);
            entity.Property(task => task.AssignedUserName).HasMaxLength(80);
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

        modelBuilder.Entity<ChatMessage>(entity =>
        {
            entity.HasIndex(message => new { message.SenderId, message.ReceiverId, message.CreatedAt });
            entity.HasIndex(message => new { message.ReceiverId, message.SenderId, message.CreatedAt });
            entity.HasIndex(message => new { message.ReceiverId, message.ReadAt });
            entity.Property(message => message.Text).HasMaxLength(2000);
            entity.HasOne(message => message.Sender)
                .WithMany()
                .HasForeignKey(message => message.SenderId)
                .OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(message => message.Receiver)
                .WithMany()
                .HasForeignKey(message => message.ReceiverId)
                .OnDelete(DeleteBehavior.Cascade);
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
