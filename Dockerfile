FROM node:24-alpine AS client-build
WORKDIR /src/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server-build
WORKDIR /src
COPY server/*.csproj ./server/
RUN dotnet restore ./server/LShopOzonWebReact.Api.csproj
COPY server/ ./server/
RUN dotnet publish ./server/LShopOzonWebReact.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=server-build /app/publish ./
COPY --from=client-build /src/client/dist ./wwwroot
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "LShopOzonWebReact.Api.dll"]
