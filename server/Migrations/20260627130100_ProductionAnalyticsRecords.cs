using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProductionAnalyticsRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProductionAnalyticsTaskRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceTaskId = table.Column<Guid>(type: "uuid", nullable: true),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RecordedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    UpdatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    OzonProductId = table.Column<long>(type: "bigint", nullable: false),
                    OfferId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ProductName = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    RequiredQuantity = table.Column<int>(type: "integer", nullable: false),
                    ActualQuantity = table.Column<int>(type: "integer", nullable: true),
                    TaskType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    IsUrgent = table.Column<bool>(type: "boolean", nullable: false),
                    AssignedUserName = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    AssignedUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedByDisplayName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ItemsJson = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductionAnalyticsTaskRecords", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProductionAnalyticsTaskRecords_AssignedUserId",
                table: "ProductionAnalyticsTaskRecords",
                column: "AssignedUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ProductionAnalyticsTaskRecords_CompletedAt",
                table: "ProductionAnalyticsTaskRecords",
                column: "CompletedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ProductionAnalyticsTaskRecords_SourceTaskId",
                table: "ProductionAnalyticsTaskRecords",
                column: "SourceTaskId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProductionAnalyticsTaskRecords");
        }
    }
}
