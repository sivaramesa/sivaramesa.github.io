import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_navigation_flutter/google_navigation_flutter.dart';
import 'package:hc_core/hc_core.dart';

import '../services.dart';

/// The caregiver's active job: shows the start code, starts turn-by-turn
/// navigation to the client, streams live location over SignalR + Firestore,
/// then arrival and completion (requirements 4, 6, 8).
class ActiveJobScreen extends StatefulWidget {
  final AppServices services;
  final Caregiver caregiver;
  final String bookingId;
  const ActiveJobScreen({
    super.key,
    required this.services,
    required this.caregiver,
    required this.bookingId,
  });

  @override
  State<ActiveJobScreen> createState() => _ActiveJobScreenState();
}

class _ActiveJobScreenState extends State<ActiveJobScreen> {
  StreamSubscription<Position>? _posSub;
  bool _navigating = false;
  bool _busy = false; // guards stage buttons against double-tap
  bool _cancelHandled = false;

  /// Run a stage action guarded against double-taps.
  Future<void> _guard(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      _toast('Action failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _labelize(String s) => s
      .replaceAll('_', ' ')
      .split(' ')
      .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');

  void _toast(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  void dispose() {
    _posSub?.cancel();
    if (_navigating) GoogleMapsNavigator.cleanup();
    super.dispose();
  }

  /// req 6 — begin travel: start turn-by-turn navigation to the client and
  /// stream location so the client can watch progress live.
  Future<void> _startTravel(Booking b) async {
    await widget.services.lifecycle.startTravel(b, widget.caregiver);
    _startLocationSharing(b.id);

    if (b.location.lat != null) {
      try {
        if (!await GoogleMapsNavigator.areTermsAccepted()) {
          await GoogleMapsNavigator.showTermsAndConditionsDialog(
              'HomeCare Caregiver', 'HomeCare');
        }
        await GoogleMapsNavigator.initializeNavigationSession();
        final destinations = Destinations(
          waypoints: [
            NavigationWaypoint.withLatLngTarget(
              title: 'Client',
              target: LatLng(latitude: b.location.lat!, longitude: b.location.lng!),
            ),
          ],
          displayOptions: NavigationDisplayOptions(showDestinationMarkers: true),
        );
        final status = await GoogleMapsNavigator.setDestinations(destinations);
        if (status == NavigationRouteStatus.statusOk) {
          await GoogleMapsNavigator.startGuidance();
          setState(() => _navigating = true);
        }
      } catch (e) {
        _toast('Navigation unavailable: $e');
      }
    }
    _toast('Travelling — live location shared with the client.');
  }

  void _startLocationSharing(String bookingId) {
    _posSub?.cancel();
    _posSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 10),
    ).listen((pos) async {
      final fresh = await widget.services.repo.getBooking(bookingId);
      if (fresh == null) return;
      // keep tracking fresh through arrival + service (needed by the client's
      // start gate and the caregiver's own complete gate). pushLocation itself
      // ignores non-trackable statuses.
      await widget.services.lifecycle.pushLocation(fresh, pos.latitude, pos.longitude);
    });
  }

  void _stopSharing() {
    _posSub?.cancel();
    _posSub = null;
    if (_navigating) {
      GoogleMapsNavigator.cleanup();
      _navigating = false;
    }
  }

  Future<void> _arrived(Booking b) async {
    // capture a fresh position and fold it into the SAME arrival write — a
    // separate en_route write here can echo back and revert ARRIVED.
    double? lat, lng;
    try {
      final pos = await Geolocator.getCurrentPosition();
      lat = pos.latitude;
      lng = pos.longitude;
    } catch (_) {}
    await widget.services.lifecycle.markArrived(b, lat: lat, lng: lng);
    _startLocationSharing(b.id); // keep sharing through ARRIVED / IN_SERVICE
    _toast('Arrived — read the start code to the client to begin.');
  }

  /// req 8 — gated by proximity when location verification is enabled.
  Future<void> _requestCompletion(Booking b) async {
    final settings = await widget.services.settings.load();
    if (settings.locationVerification) {
      HcLocation? here;
      try {
        final pos = await Geolocator.getCurrentPosition();
        here = HcLocation(lat: pos.latitude, lng: pos.longitude);
      } catch (_) {}
      final v = Geo.checkProximity(here, b.location, settings);
      if (!v.ok) {
        _toast(v.reason == 'location unavailable'
            ? 'Cannot read your location — required to complete service.'
            : 'You are ${v.distanceMeters ?? '—'} m away. Must be within ${settings.verifyRadiusMeters.toStringAsFixed(0)} m to complete.');
        return;
      }
    }
    await widget.services.lifecycle.requestCompletion(b);
    _stopSharing();
    _toast('Completion requested — client confirms with code + rating.');
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<Booking?>(
      stream: widget.services.repo.bookingStream(widget.bookingId),
      builder: (context, snap) {
        final b = snap.data;
        if (b == null) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (b.status == BookingStatus.completed) _stopSharing();
        // admin cancelled this job while it was in progress: stop sharing +
        // free up + return to the queue cleanly (HomeScreen re-routes since it's
        // no longer active).
        if (b.status == BookingStatus.cancelled && !_cancelHandled) {
          _cancelHandled = true;
          _stopSharing();
          WidgetsBinding.instance.addPostFrameCallback((_) async {
            if (widget.caregiver.availability == Availability.onService) {
              await widget.services.repo
                  .saveCaregiver(widget.caregiver.copyWith(availability: Availability.available));
            }
            if (mounted) {
              _toast('This job was cancelled. You are available again.');
            }
          });
          return const Scaffold(body: Center(child: Text('Job cancelled.')));
        }

        return Scaffold(
          appBar: AppBar(title: const Text('Current job'), actions: [
            Padding(padding: const EdgeInsets.all(14), child: Text(_labelize(b.status))),
          ]),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text('${_labelize(b.speciality)} · ${b.location.address} · ₹${b.price.toStringAsFixed(0)}',
                  style: const TextStyle(color: Colors.black54)),
              const SizedBox(height: 16),
              if (b.codes.startCode != null &&
                  [BookingStatus.accepted, BookingStatus.enRoute, BookingStatus.arrived].contains(b.status))
                _codeCard('Service start code (read to client on arrival):', b.codes.startCode!),
              const SizedBox(height: 12),
              if (b.status == BookingStatus.accepted)
                FilledButton.icon(icon: const Icon(Icons.navigation), onPressed: _busy ? null : () => _guard(() => _startTravel(b)), label: const Text('Start travel & share location')),
              if (b.status == BookingStatus.enRoute)
                FilledButton(onPressed: _busy ? null : () => _guard(() => _arrived(b)), child: const Text("I've arrived")),
              if (b.status == BookingStatus.inService)
                FilledButton(onPressed: _busy ? null : () => _guard(() => _requestCompletion(b)), child: const Text('Complete service')),
              if (b.status == BookingStatus.completionPending)
                _codeCard('Completion code sent to client:', b.codes.completeCode ?? '——————'),
              if (b.status == BookingStatus.completionPending)
                const Padding(padding: EdgeInsets.only(top: 10), child: Text('Waiting for the client to confirm with rating…', textAlign: TextAlign.center)),
              if (b.status == BookingStatus.completed)
                const Padding(padding: EdgeInsets.only(top: 20), child: Text('Service completed. You are available again.', textAlign: TextAlign.center)),
            ],
          ),
        );
      },
    );
  }

  Widget _codeCard(String label, String code) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(children: [
            Text(label),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              alignment: Alignment.center,
              decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(8)),
              child: Text(code, style: const TextStyle(color: Colors.white, fontSize: 24, letterSpacing: 5, fontWeight: FontWeight.bold)),
            ),
          ]),
        ),
      );
}
