import 'dart:async';

import 'package:signalr_netcore/signalr_client.dart';

import '../config.dart';

/// A single live-location update flowing over SignalR.
class TrackingUpdate {
  final String bookingId;
  final double lat;
  final double lng;
  final int? etaMinutes;
  TrackingUpdate(this.bookingId, this.lat, this.lng, this.etaMinutes);
}

/// Real-time live-tracking client backed by the ASP.NET Core SignalR hub.
///
/// This is the spec's "WebSockets / SignalR" live tracking. The caregiver app
/// pushes its position with [sendLocation]; the client app joins the booking's
/// group with [joinBooking] and receives [updates].
///
/// Hub contract (see server/HealthCareHub):
///   - client -> hub:  JoinBooking(bookingId)
///   - client -> hub:  SendLocation(bookingId, lat, lng, etaMinutes)
///   - hub  -> client: ReceiveLocation(bookingId, lat, lng, etaMinutes)
class TrackingService {
  HubConnection? _hub;
  final _controller = StreamController<TrackingUpdate>.broadcast();

  Stream<TrackingUpdate> get updates => _controller.stream;
  bool get isConnected => _hub?.state == HubConnectionState.Connected;

  Future<void> connect() async {
    if (isConnected) return;
    final hub = HubConnectionBuilder()
        .withUrl(HcConfig.signalRHubUrl)
        .withAutomaticReconnect()
        .build();

    hub.on('ReceiveLocation', (args) {
      if (args == null || args.length < 3) return;
      final bookingId = args[0] as String;
      final lat = (args[1] as num).toDouble();
      final lng = (args[2] as num).toDouble();
      final eta = args.length > 3 ? (args[3] as num?)?.toInt() : null;
      _controller.add(TrackingUpdate(bookingId, lat, lng, eta));
    });

    await hub.start();
    _hub = hub;
  }

  /// Subscribe to a booking's location group (client side).
  Future<void> joinBooking(String bookingId) async {
    await connect();
    await _hub!.invoke('JoinBooking', args: [bookingId]);
  }

  /// Push a location update (caregiver side).
  Future<void> sendLocation(
      String bookingId, double lat, double lng, int? etaMinutes) async {
    await connect();
    await _hub!.invoke('SendLocation', args: [bookingId, lat, lng, etaMinutes]);
  }

  Future<void> dispose() async {
    await _hub?.stop();
    await _controller.close();
  }
}
