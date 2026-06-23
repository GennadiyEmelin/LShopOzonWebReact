using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProductionTaskUrgentAndCancelled : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CancelledAt",
                table: "ProductionTasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CancellationComment",
                table: "ProductionTasks",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CreatedByDisplayName",
                table: "ProductionTasks",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CreatedByUserId",
                table: "ProductionTasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsUrgent",
                table: "ProductionTasks",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql("""
                UPDATE "ProductionTasks"
                SET "Status" = 'Cancelled', "CancelledAt" = "DeferredAt"
                WHERE "Status" = 'Deferred';
                """);

            migrationBuilder.Sql("""
                UPDATE "Users"
                SET "AllowedFeatures" = REPLACE("AllowedFeatures", 'production.deferred', 'production.cancelled')
                WHERE "AllowedFeatures" LIKE '%production.deferred%';
                """);

            migrationBuilder.DropColumn(
                name: "DeferredAt",
                table: "ProductionTasks");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeferredAt",
                table: "ProductionTasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.Sql("""
                UPDATE "ProductionTasks"
                SET "Status" = 'Deferred', "DeferredAt" = "CancelledAt"
                WHERE "Status" = 'Cancelled';
                """);

            migrationBuilder.Sql("""
                UPDATE "Users"
                SET "AllowedFeatures" = REPLACE("AllowedFeatures", 'production.cancelled', 'production.deferred')
                WHERE "AllowedFeatures" LIKE '%production.cancelled%';
                """);

            migrationBuilder.DropColumn(
                name: "CancelledAt",
                table: "ProductionTasks");

            migrationBuilder.DropColumn(
                name: "CancellationComment",
                table: "ProductionTasks");

            migrationBuilder.DropColumn(
                name: "CreatedByDisplayName",
                table: "ProductionTasks");

            migrationBuilder.DropColumn(
                name: "CreatedByUserId",
                table: "ProductionTasks");

            migrationBuilder.DropColumn(
                name: "IsUrgent",
                table: "ProductionTasks");
        }
    }
}
