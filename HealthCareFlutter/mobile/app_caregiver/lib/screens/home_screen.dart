import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:hc_core/hc_core.dart';

import '../main.dart';
import '../services.dart';
import 'active_job_screen.dart';

/// Availability toggle + incoming request queue. When a job is active, routes
/// to the active-job screen. Driven by the live bookings + caregiver streams.
class HomeScreen extends StatefulWidget {
  final AppServices services;
  final String caregiverId;
  final Session session;
  const HomeScreen({super.key, required this.services, required this.caregiverId, required this.session});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  AppSettings _settings = const AppSettings();
  bool _accepting = false;

  @override
  void initState() {
    super.initState();
    widget.services.settings.stream().listen((s) {
      if (mounted) setState(() => _settings = s);
    });
  }

  String _labelize(String s) => s
      .replaceAll('_', ' ')
      .split(' ')
      .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
      .join(' ');

  void _toast(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _setAvailability(Caregiver cg, String value) async {
    var updated = cg;
    if (value == Availability.available) {
      try {
        final perm = await Geolocator.checkPermission();
        if (perm == LocationPermission.denied) await Geolocator.requestPermission();
        final pos = await Geolocator.getCurrentPosition();
        updated = cg.copyWith(location: HcLocation(lat: pos.latitude, lng: pos.longitude));
      } catch (_) {
        _toast('Could not read location — requests may not match by distance.');
      }
    }
    await widget.services.repo.saveCaregiver(updated.copyWith(availability: value));
  }

  Future<void> _accept(Booking b, Caregiver cg) async {
    if (_accepting) return; // guard against a double tap
    setState(() => _accepting = true);
    try {
      final fresh = await widget.services.repo.getBooking(b.id);
      if (fresh == null || fresh.status != BookingStatus.broadcast) {
        _toast('This request was already taken.');
        return;
      }
      await widget.services.lifecycle.accept(fresh, cg);
      _toast('Job accepted. Share the start code with the client on arrival.');
    } finally {
      if (mounted) setState(() => _accepting = false);
    }
  }

  /// Is this caregiver an admin-invited target for the booking?
  bool _meInvited(Booking b, Caregiver me) => b.invitedCaregiverIds.contains(me.id);

  /// Queue for [me]: admin invites first (bypass radius; speciality still
  /// required; shown even when off-duty), then the normal eligible broadcast
  /// requests (only when available).
  List<Booking> _buildQueue(List<Booking> all, Caregiver me) {
    final available = me.availability == Availability.available;
    final open = all.where((b) => b.status == BookingStatus.broadcast).toList();
    final forMe = open.where((b) {
      final specOk = me.specialities.contains(b.speciality);
      if (_meInvited(b, me)) return specOk; // invited bypasses radius
      if (!available) return false;
      return Geo.eligibleCaregivers(b, [me], b.radiusKm, _settings.matchLocationMode).isNotEmpty;
    }).toList();
    // invited first (high precedence)
    forMe.sort((a, b) => (_meInvited(b, me) ? 1 : 0) - (_meInvited(a, me) ? 1 : 0));
    return forMe;
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Caregiver>>(
      stream: widget.services.repo.caregiversStream(),
      builder: (context, cgSnap) {
        final me = (cgSnap.data ?? const <Caregiver>[])
            .where((c) => c.id == widget.caregiverId)
            .cast<Caregiver?>()
            .firstWhere((c) => true, orElse: () => null);
        if (me == null) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }

        return StreamBuilder<List<Booking>>(
          stream: widget.services.repo.bookingsStream(),
          builder: (context, bSnap) {
            final all = bSnap.data ?? const <Booking>[];
            Booking? active;
            for (final b in all) {
              if (b.caregiverId == me.id && b.isActive) { active = b; break; }
            }
            if (active != null) {
              return ActiveJobScreen(services: widget.services, caregiver: me, bookingId: active.id);
            }

            // request queue: admin invites (precedence) + eligible broadcasts
            final queue = _buildQueue(all, me);

            return Scaffold(
              appBar: AppBar(
                title: Text('Hi, ${me.name}'),
                actions: [
                  Padding(padding: const EdgeInsets.all(14), child: Center(child: Text(_labelize(me.availability)))),
                  HcThemeButton(controller: hcTheme),
                ],
              ),
              body: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text((me.specialities).map(_labelize).join(', '), style: const TextStyle(color: Colors.black54)),
                  const SizedBox(height: 12),
                  Row(children: [
                    Expanded(child: FilledButton(onPressed: () => _setAvailability(me, Availability.available), child: const Text("I'm available"))),
                    const SizedBox(width: 10),
                    Expanded(child: OutlinedButton(onPressed: () => _setAvailability(me, Availability.unavailable), child: const Text('Go offline'))),
                  ]),
                  const SizedBox(height: 20),
                  Text('Service requests', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  if (queue.isEmpty)
                    Text(
                      me.availability == Availability.available
                          ? 'No open requests right now.'
                          : 'Go available to receive requests.',
                      style: const TextStyle(color: Colors.black54),
                    )
                  else
                    ...queue.map((b) {
                      final invited = _meInvited(b, me);
                      return Card(
                        color: invited
                            ? const Color(0xFFE8F7EE)
                            : (b.priority ? const Color(0xFFFFF4E5) : null),
                        child: ListTile(
                          title: Text(
                              '${b.priority ? '⚡ ' : ''}${b.clonedFrom != null ? '↻ ' : ''}'
                              '${_labelize(b.speciality)} · ₹${b.price.toStringAsFixed(0)}'),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(b.location.address.isEmpty ? b.location.label : b.location.address),
                              if (invited)
                                const Text('★ Admin invite — priority',
                                    style: TextStyle(color: Colors.green, fontSize: 12)),
                              if (b.scheduledAt != null)
                                Text('When: ${DateTime.tryParse(b.scheduledAt!)?.toLocal().toString().substring(0, 16) ?? ''}',
                                    style: const TextStyle(fontSize: 12)),
                            ],
                          ),
                          isThreeLine: invited || b.scheduledAt != null,
                          trailing: FilledButton(
                              onPressed: _accepting ? null : () => _accept(b, me),
                              child: const Text('Accept')),
                        ),
                      );
                    }),
                ],
              ),
            );
          },
        );
      },
    );
  }
}
