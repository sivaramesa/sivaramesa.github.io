using HealthCareHub.Hubs;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();

// Allow the mobile apps (any origin during dev) to connect. Tighten the
// allowed origins for production.
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.SetIsOriginAllowed(_ => true)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors();

app.MapGet("/", () => "HealthCare SignalR hub is running. Hub at /hubs/tracking");
app.MapHub<TrackingHub>("/hubs/tracking");

app.Run();
