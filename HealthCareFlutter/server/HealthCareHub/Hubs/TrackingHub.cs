using Microsoft.AspNetCore.SignalR;

namespace HealthCareHub.Hubs;

/// <summary>
/// Real-time live-tracking hub. Matches the contract the Flutter hc_core
/// TrackingService expects:
///   - JoinBooking(bookingId)          : client joins a booking's group
///   - LeaveBooking(bookingId)         : client leaves the group
///   - SendLocation(bookingId,...)     : caregiver pushes its position
///   -> ReceiveLocation(bookingId,...) : broadcast to everyone in the group
///
/// A "group" is one per booking, so a caregiver's location only reaches the
/// client tracking that booking.
/// </summary>
public class TrackingHub : Hub
{
    private static string Group(string bookingId) => $"booking:{bookingId}";

    public Task JoinBooking(string bookingId)
        => Groups.AddToGroupAsync(Context.ConnectionId, Group(bookingId));

    public Task LeaveBooking(string bookingId)
        => Groups.RemoveFromGroupAsync(Context.ConnectionId, Group(bookingId));

    /// <summary>Caregiver pushes a location; fan it out to the booking group.</summary>
    public async Task SendLocation(string bookingId, double lat, double lng, int? etaMinutes)
    {
        await Clients.Group(Group(bookingId))
            .SendAsync("ReceiveLocation", bookingId, lat, lng, etaMinutes);
    }

    /// <summary>Optional: broadcast a booking status change to the group.</summary>
    public async Task SendStatus(string bookingId, string status)
    {
        await Clients.Group(Group(bookingId))
            .SendAsync("ReceiveStatus", bookingId, status);
    }
}
