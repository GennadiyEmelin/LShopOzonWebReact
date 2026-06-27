using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class KzMarketplaceIntegrations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HalykApiKey",
                table: "AppIntegrationSettings",
                type: "character varying(240)",
                maxLength: 240,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "HalykMerchantId",
                table: "AppIntegrationSettings",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "KaspiApiKey",
                table: "AppIntegrationSettings",
                type: "character varying(240)",
                maxLength: 240,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "KaspiMerchantId",
                table: "AppIntegrationSettings",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SatuApiKey",
                table: "AppIntegrationSettings",
                type: "character varying(240)",
                maxLength: 240,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SatuMerchantId",
                table: "AppIntegrationSettings",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HalykApiKey",
                table: "AppIntegrationSettings");

            migrationBuilder.DropColumn(
                name: "HalykMerchantId",
                table: "AppIntegrationSettings");

            migrationBuilder.DropColumn(
                name: "KaspiApiKey",
                table: "AppIntegrationSettings");

            migrationBuilder.DropColumn(
                name: "KaspiMerchantId",
                table: "AppIntegrationSettings");

            migrationBuilder.DropColumn(
                name: "SatuApiKey",
                table: "AppIntegrationSettings");

            migrationBuilder.DropColumn(
                name: "SatuMerchantId",
                table: "AppIntegrationSettings");
        }
    }
}
