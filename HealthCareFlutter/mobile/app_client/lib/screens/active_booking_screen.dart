import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:hc_core/hc_core.dart';

import '../services.dart';

/// The client's live view of an active booking. Reacts to the single-booking
/// Firestore stream and, while en route, to SignalR location pings.
class ActiveBookingScreen extends StatefulWidget {
  final AppServices services;
  final Client client;
  final String bookingId;
  const ActiveBookingScreen({
    super.key,
    required this.services,
    required this.client,
    required this.bookingId,
  });

  @override
  State<ActiveBookingScreen> createState() => _ActiveBookingScreenState();
}

class _ActiveBookingScreenState extends State<ActiveBookingScreen> {
  final _startCode = TextEditingController();
  final _completeCode = TextEditingController();
  final _comments = TextEditingController();
  int _stars = 0;
  GoogleMapController? _map;
  LatLng? _caregiverPos;
  String _etaText = '';
  StreamSubscription<TrackingUpdate>? _trackSub;
  bool _joined = false;

  AppSettings _settings = const AppSettings();
  StreamSubscription<AppSettings>? _settingsSub;
  List<Caregiver> _caregivers = const [];
  StreamSubscription<List<Caregiver>>? _cgSub;

  @override
  void initState() {
    super.initState();
    _settingsSub = widget.services.settings.stream().listen((s) {
      if (mounted) setState(() => _settings = s);
    });
    _cgSub = widget.services.repo.caregiversStream().listen((list) {
      if (mounted) setState(() => _caregivers = list);
    });
  }

  /// Start-code display honouring the location-verification mask: when the flag
  /// is ON and the caregiver isn't within range, the code is masked and the
  /// start button is locked. Caregiver position comes from booking.tracking.
  ({String text, bool unlocked, ProximityVerdict? verdict}) _startCodeDisplay(Booking b) {
    final real = b.codes.startCode ?? '——————';
    if (!_settings.locationVerification) {
      return (text: real, unlocked: true, verdict: null);
    }
    final cgLoc = b.tracking.lat != null
        ? HcLocation(lat: b.tracking.lat, lng: b.tracking.lng)
        : null;
    final v = Geo.checkProximity(cgLoc, b.location, _settings);
    return (text: v.ok ? real : '••••••', unlocked: v.ok, verdict: v);
  }

  String _labelize(String s) => s
      .replaceAll('_', ' ')
      .split(' ')
      .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');

  Future<void> _ensureTracking(Booking b) async {
    if (_joined) return;
    _joined = true;
    try {
      await widget.services.tracking.joinBooking(b.id);
      _trackSub = widget.services.tracking.updates.listen((u) {
        if (u.bookingId != b.id) return;
        setState(() {
          _caregiverPos = LatLng(u.lat, u.lng);
          _etaText = u.etaMinutes != null ? 'ETA ~${u.etaMinutes} min' : '';
        });
        _map?.animateCamera(CameraUpdate.newLatLng(_caregiverPos!));
      });
    } catch (_) {/* hub offline — Firestore tracking still updates the fields */}
  }

  @override
  void dispose() {
    _trackSub?.cancel();
    _settingsSub?.cancel();
    _cgSub?.cancel();
    super.dispose();
  }

  void _toast(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _verifyStart(Booking b) async {
    if (_settings.locationVerification && !_startCodeDisplay(b).unlocked) {
      _toast('Caregiver is not within range yet.');
      return;
    }
    final (ok, _) = await widget.services.lifecycle.verifyStartCode(b, _startCode.text);
    _toast(ok ? 'Verified — service started.' : 'Code did not match.');
  }

  Future<void> _verifyComplete(Booking b) async {
    final cg = b.caregiverId == null ? null : await widget.services.repo.getCaregiver(b.caregiverId!);
    final (ok, _) = await widget.services.lifecycle
        .verifyCompletion(b, _completeCode.text, _stars == 0 ? null : _stars, _comments.text, cg);
    _toast(ok ? 'Service completed. Thank you!' : 'Completion code did not match.');
  }

  bool _cancellable(Booking b) => const [
        BookingStatus.created,
        BookingStatus.paid,
        BookingStatus.broadcast,
      ].contains(b.status);

  Future<void> _cancel(Booking b) async {
    final reasons = _settings.cancelReasons;
    String selected = reasons.isNotEmpty ? reasons.first : '__other__';
    final otherCtrl = TextEditingController();
    final paid = b.payment.status == 'paid';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, setLocal) => AlertDialog(
          title: const Text('Cancel booking'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(paid ? '₹${b.price.toStringAsFixed(0)} will be refunded.' : 'Your request will be cancelled.'),
              const SizedBox(height: 8),
              const Text('Reason'),
              DropdownButton<String>(
                isExpanded: true,
                value: selected,
                items: [
                  for (final r in reasons) DropdownMenuItem(value: r, child: Text(r)),
                  const DropdownMenuItem(value: '__other__', child: Text('Other (free text)')),
                ],
                onChanged: (v) => setLocal(() => selected = v ?? selected),
              ),
              if (selected == '__other__')
                TextField(controller: otherCtrl, decoration: const InputDecoration(labelText: 'Please specify')),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep booking')),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Confirm cancellation')),
          ],
        ),
      ),
    );
    if (confirmed != true) return;

    final isOther = selected == '__other__';
    final reason = isOther ? otherCtrl.text.trim() : selected;
    if (isOther && reason.isEmpty) return _toast('Please specify the reason.');

    // re-check status at click time
    final fresh = await widget.services.repo.getBooking(b.id);
    if (fresh == null || !_cancellable(fresh)) {
      return _toast('A caregiver has already accepted this booking.');
    }
    final (_, rev) = await widget.services.lifecycle
        .cancel(fresh, reason: reason, reasonCode: isOther ? 'Other' : selected, by: 'client');
    _toast(rev.type == 'refund'
        ? 'Booking cancelled — refund of ₹${rev.amount.toStringAsFixed(0)} initiated.'
        : 'Your request was cancelled.');
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
        // fall back to Firestore tracking coords when SignalR isn't connected
        if (_caregiverPos == null && b.tracking.lat != null) {
          _caregiverPos = LatLng(b.tracking.lat!, b.tracking.lng!);
          if (b.tracking.etaMinutes != null) _etaText = 'ETA ~${b.tracking.etaMinutes} min';
        }
        if (b.status == BookingStatus.enRoute || b.status == BookingStatus.arrived) {
          _ensureTracking(b);
        }

        return Scaffold(
          appBar: AppBar(
            title: const Text('Your booking'),
            actions: [Padding(padding: const EdgeInsets.all(14), child: _StatusChip(b.status, _labelize))],
          ),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                '${b.priority ? '⚡ ' : ''}${b.clonedFrom != null ? '↻ ' : ''}'
                '${_labelize(b.speciality)} · ${b.location.address} · ₹${b.price.toStringAsFixed(0)}',
                style: const TextStyle(color: Colors.black54),
              ),
              if (b.scheduledAt != null)
                Text('Scheduled: ${DateTime.tryParse(b.scheduledAt!)?.toLocal().toString().substring(0, 16) ?? b.scheduledAt}',
                    style: const TextStyle(color: Colors.black54, fontSize: 12)),
              const SizedBox(height: 12),
              if (_cancellable(b))
                Align(
                  alignment: Alignment.centerLeft,
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.close, size: 18),
                    label: const Text('Cancel booking'),
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.red),
                    onPressed: () => _cancel(b),
                  ),
                ),
              if (_cancellable(b)) const SizedBox(height: 8),
              if (b.status == BookingStatus.broadcast) _availabilityCard(b),
              if (b.caregiverId != null) _caregiverCard(b),
              if (b.status == BookingStatus.enRoute || b.status == BookingStatus.arrived)
                _trackingCard(b),
              if (b.status == BookingStatus.arrived) _startVerifyCard(b),
              if (b.status == BookingStatus.completionPending) _completeCard(b),
              if (b.status == BookingStatus.completed) _doneCard(),
            ],
          ),
        );
      },
    );
  }

  /// Live count of caregivers actively available within range, while broadcasting.
  Widget _availabilityCard(Booking b) {
    final count = Geo.eligibleCaregivers(b, _caregivers, b.radiusKm, _settings.matchLocationMode).length;
    return Card(
      color: const Color(0xFFEEF6FF),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Text(
          count > 0
              ? '$count caregiver${count == 1 ? '' : 's'} available within ${b.radiusKm?.toStringAsFixed(0)} km — waiting for one to accept…'
              : 'No caregivers currently available within ${b.radiusKm?.toStringAsFixed(0)} km. Waiting for someone to come online…',
        ),
      ),
    );
  }

  Widget _caregiverPhoto(Caregiver? cg) {
    final photo = cg?.photo;
    if (photo == null || photo.isEmpty) {
      return const CircleAvatar(radius: 24, child: Icon(Icons.medical_services));
    }
    try {
      // stored as a data URL (data:image/...;base64,XXXX) or raw base64
      final b64 = photo.contains(',') ? photo.split(',').last : photo;
      return CircleAvatar(radius: 24, backgroundImage: MemoryImage(base64Decode(b64)));
    } catch (_) {
      return const CircleAvatar(radius: 24, child: Icon(Icons.person));
    }
  }

  Widget _caregiverCard(Booking b) {
    final cg = _caregivers.where((c) => c.id == b.caregiverId).cast<Caregiver?>().firstWhere((_) => true, orElse: () => null);
    final disp = _startCodeDisplay(b);
    final preArrival = b.status == BookingStatus.accepted || b.status == BookingStatus.enRoute;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              _caregiverPhoto(cg),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(cg?.name ?? b.caregiverName ?? 'Caregiver',
                        style: const TextStyle(fontWeight: FontWeight.bold)),
                    Text(cg == null ? '' : '★ ${cg.rating} (${cg.ratingCount})',
                        style: const TextStyle(color: Colors.black54)),
                  ],
                ),
              ),
            ]),
            if (preArrival && b.codes.startCode != null) ...[
              const SizedBox(height: 10),
              const Text('Service start code', style: TextStyle(color: Colors.black54)),
              const SizedBox(height: 4),
              _codeBox(disp.text),
              if (_settings.locationVerification && !disp.unlocked)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    disp.verdict?.reason == 'location unavailable'
                        ? 'Unlocks when the caregiver is in range.'
                        : 'Caregiver ${disp.verdict?.distanceMeters ?? '—'} m away — unlocks within ${_settings.verifyRadiusMeters.toStringAsFixed(0)} m.',
                    style: const TextStyle(color: Colors.red, fontSize: 12),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _codeBox(String code) => Container(
        padding: const EdgeInsets.all(12),
        alignment: Alignment.center,
        decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(8)),
        child: Text(code,
            style: const TextStyle(color: Colors.white, fontSize: 22, letterSpacing: 4, fontWeight: FontWeight.bold)),
      );

  Widget _trackingCard(Booking b) => Card(
        child: Column(
          children: [
            SizedBox(
              height: 260,
              child: (b.location.lat == null)
                  ? const Center(child: Text('Live map needs a mapped address.'))
                  : GoogleMap(
                      initialCameraPosition: CameraPosition(
                        target: LatLng(b.location.lat!, b.location.lng!),
                        zoom: 13,
                      ),
                      onMapCreated: (c) => _map = c,
                      markers: {
                        Marker(
                          markerId: const MarkerId('home'),
                          position: LatLng(b.location.lat!, b.location.lng!),
                          infoWindow: const InfoWindow(title: 'Your location'),
                        ),
                        if (_caregiverPos != null)
                          Marker(
                            markerId: const MarkerId('caregiver'),
                            position: _caregiverPos!,
                            infoWindow: const InfoWindow(title: 'Caregiver'),
                          ),
                      },
                    ),
            ),
            Padding(padding: const EdgeInsets.all(10), child: Text(_etaText.isEmpty ? 'Waiting for location…' : _etaText)),
          ],
        ),
      );

  Widget _startVerifyCard(Booking b) {
    final disp = _startCodeDisplay(b);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Caregiver arrived. Your service start code is:'),
            const SizedBox(height: 6),
            _codeBox(disp.text),
            if (_settings.locationVerification)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  disp.unlocked
                      ? 'Caregiver is within ${_settings.verifyRadiusMeters.toStringAsFixed(0)} m — you can start.'
                      : disp.verdict?.reason == 'location unavailable'
                          ? 'Waiting for caregiver location… start unlocks when in range.'
                          : 'Caregiver ${disp.verdict?.distanceMeters ?? '—'} m away. Start unlocks within ${_settings.verifyRadiusMeters.toStringAsFixed(0)} m.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: disp.unlocked ? Colors.green : Colors.red),
                ),
              ),
            const SizedBox(height: 12),
            const Text('Confirm with the caregiver, then enter the code to begin:'),
            TextField(controller: _startCode, keyboardType: TextInputType.number),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: disp.unlocked ? () => _verifyStart(b) : null,
              child: const Text('Verify & start service'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _completeCard(Booking b) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Service marked complete. Your completion code is:'),
              const SizedBox(height: 6),
              Container(
                padding: const EdgeInsets.all(12),
                alignment: Alignment.center,
                decoration: BoxDecoration(color: const Color(0xFF0F172A), borderRadius: BorderRadius.circular(8)),
                child: Text(b.codes.completeCode ?? '——————',
                    style: const TextStyle(color: Colors.white, fontSize: 22, letterSpacing: 4, fontWeight: FontWeight.bold)),
              ),
              const SizedBox(height: 12),
              const Text('Re-type the code above to confirm:'),
              TextField(controller: _completeCode, keyboardType: TextInputType.number),
              const SizedBox(height: 10),
              const Text('Rating'),
              Row(
                children: [
                  for (var i = 1; i <= 5; i++)
                    IconButton(
                      icon: Icon(i <= _stars ? Icons.star : Icons.star_border, color: Colors.amber),
                      onPressed: () => setState(() => _stars = i),
                    ),
                ],
              ),
              TextField(controller: _comments, decoration: const InputDecoration(labelText: 'Comments')),
              const SizedBox(height: 10),
              FilledButton(onPressed: () => _verifyComplete(b), child: const Text('Confirm completion')),
            ],
          ),
        ),
      );

  Widget _doneCard() => const Card(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Column(children: [
            Text('✅', style: TextStyle(fontSize: 40)),
            SizedBox(height: 8),
            Text('Service completed. Thank you for your feedback.'),
          ]),
        ),
      );
}

class _StatusChip extends StatelessWidget {
  final String status;
  final String Function(String) labelize;
  const _StatusChip(this.status, this.labelize);
  @override
  Widget build(BuildContext context) =>
      Chip(label: Text(labelize(status)), visualDensity: VisualDensity.compact);
}
