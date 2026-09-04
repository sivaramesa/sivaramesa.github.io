import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:hc_core/hc_core.dart';

import '../services.dart';

/// Book a service (parity with the PWA book screen):
///  - pick a service from the admin master
///  - pick when (date+time, default now + lead hours)
///  - pick recipients (self and/or saved locations) -> cost = unit x count
///  - choose the service location: a saved address, current GPS, or a new one
///  - normal (respects lead time) or Priority booking (shows extra cost)
///  - pay BEFORE the booking is persisted (no orphaned unpaid record)
class BookScreen extends StatefulWidget {
  final AppServices services;
  final Client client;
  const BookScreen({super.key, required this.services, required this.client});

  @override
  State<BookScreen> createState() => _BookScreenState();
}

class _BookScreenState extends State<BookScreen> {
  List<Service> _services = [];
  Service? _selected;
  AppSettings _settings = const AppSettings();

  DateTime _scheduledAt = DateTime.now().add(const Duration(hours: 4));
  final Set<int> _recipientIdx = {}; // indices into savedLocations selected as recipients

  // service-location chooser
  String _locMode = 'recipient'; // recipient | live | new
  int _recipientLocIndex = 0;
  HcLocation? _override; // live GPS or new address
  final _newAddr = TextEditingController();
  String _locStatus = '';

  final _radius = TextEditingController(text: '15');
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // default recipient = first saved location, if any
    if (widget.client.savedLocations.isNotEmpty) _recipientIdx.add(0);
    widget.services.settings.load().then((s) {
      if (mounted) {
        setState(() {
          _settings = s;
          _scheduledAt = DateTime.now().add(Duration(hours: s.bookingLeadHours));
        });
      }
    });
  }

  double get _unit => _selected?.cost ?? 0;
  int get _recipientCount => _recipientIdx.isEmpty ? 0 : _recipientIdx.length;
  double get _total => _unit * _recipientCount;

  HcLocation? _serviceLocation() {
    final locs = widget.client.savedLocations;
    if (_locMode == 'live' || _locMode == 'new') return _override;
    if (locs.isEmpty) return null;
    final i = _recipientLocIndex.clamp(0, locs.length - 1);
    return locs[i];
  }

  Future<void> _useLive() async {
    setState(() => _locStatus = 'Getting your location…');
    try {
      final perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) await Geolocator.requestPermission();
      final p = await Geolocator.getCurrentPosition();
      setState(() {
        _override = HcLocation(
            label: 'Current location',
            address: 'Current location (${p.latitude.toStringAsFixed(4)}, ${p.longitude.toStringAsFixed(4)})',
            lat: p.latitude,
            lng: p.longitude);
        _locStatus = 'Using your current location.';
      });
    } catch (e) {
      setState(() => _locStatus = 'Could not read location: $e');
    }
  }

  void _useNewAddress() {
    final addr = _newAddr.text.trim();
    if (addr.isEmpty) {
      setState(() => _locStatus = 'Type an address first.');
      return;
    }
    // No geocoder wired here; store as text address (matching by distance limited).
    setState(() {
      _override = HcLocation(label: 'Service address', address: addr);
      _locStatus = 'Saved address (no map pin — matching by distance limited).';
    });
  }

  Future<void> _submit(bool priority) async {
    if (_selected == null) return _toast('Pick a service.');
    if (_recipientCount == 0) return _toast('Select at least one recipient.');
    final location = _serviceLocation();
    if (location == null) {
      return _toast(_locMode == 'live'
          ? 'Tap "Get my current location" first.'
          : _locMode == 'new'
              ? 'Enter and locate the service address first.'
              : 'The selected recipient has no address.');
    }
    // normal booking must respect the lead time
    final minTime = DateTime.now().add(Duration(hours: _settings.bookingLeadHours));
    if (!priority && _scheduledAt.isBefore(minTime)) {
      return _toast('Normal bookings need ${_settings.bookingLeadHours}h lead time. Use Priority for sooner.');
    }
    final base = _total;
    final price = priority ? AppSettings.priorityPrice(base, _recipientCount, _settings) : base;
    if (priority) {
      final extra = price - base;
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Priority booking'),
          content: Text('Priority total: ₹${price.toStringAsFixed(0)}'
              '${extra > 0 ? ' (₹${extra.toStringAsFixed(0)} more than ₹${base.toStringAsFixed(0)})' : ''}.\n\nProceed?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Proceed')),
          ],
        ),
      );
      if (ok != true) return;
    }

    setState(() => _busy = true);
    try {
      final locs = widget.client.savedLocations;
      final recipients = _recipientIdx.map((i) {
        final l = locs[i];
        return BookingRecipient(name: l.label, label: l.label, address: l.address, lat: l.lat, lng: l.lng);
      }).toList();

      // pay-before-persist: build, pay (which writes the PAID booking), broadcast
      var booking = Booking(
        id: 'bk_${DateTime.now().millisecondsSinceEpoch}',
        clientId: widget.client.id,
        speciality: _selected!.key,
        serviceId: _selected!.id,
        commissionPct: _selected!.commissionPct,
        scheduledAt: _scheduledAt.toUtc().toIso8601String(),
        recipients: recipients,
        unitPrice: _unit,
        priority: priority,
        location: location,
        price: price,
        radiusKm: double.tryParse(_radius.text) ?? HcConfig.defaultMatchRadiusKm,
      );
      booking = await widget.services.lifecycle.pay(booking);
      final all = await widget.services.repo.allCaregivers();
      final (_, notified) = await widget.services.lifecycle
          .broadcast(booking, all, booking.radiusKm, _settings.matchLocationMode);
      _toast('${priority ? 'Priority request' : 'Request'} sent — ${notified.length} caregiver(s) alerted');
    } catch (e) {
      _toast('Booking failed: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toast(String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _pickWhen() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _scheduledAt,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 90)),
    );
    if (d == null) return;
    if (!mounted) return;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_scheduledAt));
    if (t == null) return;
    setState(() => _scheduledAt = DateTime(d.year, d.month, d.day, t.hour, t.minute));
  }

  @override
  Widget build(BuildContext context) {
    final locs = widget.client.savedLocations;
    return Scaffold(
      appBar: AppBar(title: const Text('Book a service')),
      body: StreamBuilder<List<Service>>(
        stream: widget.services.services.stream(),
        builder: (context, snap) {
          if (snap.hasData) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted && !_sameKeys(snap.data!)) _onServices(snap.data!);
            });
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('Service needed'),
              DropdownButton<String>(
                isExpanded: true,
                value: _selected?.key,
                items: _services
                    .map((s) => DropdownMenuItem(value: s.key, child: Text('${s.name} — ₹${s.cost.toStringAsFixed(0)}')))
                    .toList(),
                onChanged: (v) => setState(() => _selected = _services.firstWhere((s) => s.key == v)),
              ),
              const SizedBox(height: 12),
              const Text('When do you need it?'),
              OutlinedButton.icon(
                icon: const Icon(Icons.event),
                label: Text(_scheduledAt.toLocal().toString().substring(0, 16)),
                onPressed: _pickWhen,
              ),
              const SizedBox(height: 12),
              const Text('Who is this service for?'),
              if (locs.isEmpty)
                const Text('No saved locations. Ask admin to add one.', style: TextStyle(color: Colors.redAccent)),
              for (var i = 0; i < locs.length; i++)
                CheckboxListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  value: _recipientIdx.contains(i),
                  title: Text('${locs[i].label}: ${locs[i].address}'),
                  onChanged: (v) => setState(() {
                    if (v == true) {
                      _recipientIdx.add(i);
                    } else {
                      _recipientIdx.remove(i);
                    }
                  }),
                ),
              const SizedBox(height: 12),
              const Text('Service location'),
              DropdownButton<String>(
                isExpanded: true,
                value: _locMode,
                items: const [
                  DropdownMenuItem(value: 'recipient', child: Text("Use recipient's saved address")),
                  DropdownMenuItem(value: 'live', child: Text('Use my current (live) location')),
                  DropdownMenuItem(value: 'new', child: Text('Enter a new address')),
                ],
                onChanged: (v) => setState(() {
                  _locMode = v ?? 'recipient';
                  if (_locMode == 'recipient') _override = null;
                  _locStatus = '';
                }),
              ),
              if (_locMode == 'recipient' && locs.isNotEmpty)
                DropdownButton<int>(
                  isExpanded: true,
                  value: _recipientLocIndex.clamp(0, locs.length - 1),
                  items: [
                    for (var i = 0; i < locs.length; i++)
                      DropdownMenuItem(value: i, child: Text('${locs[i].label}: ${locs[i].address}')),
                  ],
                  onChanged: (v) => setState(() => _recipientLocIndex = v ?? 0),
                ),
              if (_locMode == 'live')
                Row(children: [
                  OutlinedButton(onPressed: _useLive, child: const Text('Get my current location')),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_locStatus, style: const TextStyle(fontSize: 12))),
                ]),
              if (_locMode == 'new') ...[
                TextField(controller: _newAddr, decoration: const InputDecoration(labelText: 'Service address')),
                Row(children: [
                  OutlinedButton(onPressed: _useNewAddress, child: const Text('Use address')),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_locStatus, style: const TextStyle(fontSize: 12))),
                ]),
              ],
              const SizedBox(height: 12),
              TextField(
                controller: _radius,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Match radius (km)'),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Total: ₹${_total.toStringAsFixed(0)}   '
                        '(₹${_unit.toStringAsFixed(0)} × $_recipientCount)'),
                    if (_recipientCount > 0 && _selected != null)
                      Builder(builder: (_) {
                        final pTotal = AppSettings.priorityPrice(_total, _recipientCount, _settings);
                        final extra = pTotal - _total;
                        return extra > 0
                            ? Text('Priority: ₹${pTotal.toStringAsFixed(0)} (₹${extra.toStringAsFixed(0)} more)',
                                style: const TextStyle(color: Colors.orange))
                            : const SizedBox.shrink();
                      }),
                  ]),
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _busy ? null : () => _submit(false),
                child: _busy
                    ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Pay & request caregiver'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: _busy ? null : () => _submit(true),
                child: const Text('⚡ Priority booking'),
              ),
              const SizedBox(height: 8),
              const Text('Payment is captured first, then nearby caregivers are alerted.',
                  textAlign: TextAlign.center, style: TextStyle(fontSize: 12)),
            ],
          );
        },
      ),
    );
  }

  void _onServices(List<Service> list) {
    final active = list.where((s) => s.active).toList();
    setState(() {
      _services = active;
      _selected = active.firstWhere(
        (s) => _selected != null && s.key == _selected!.key,
        orElse: () => active.isNotEmpty ? active.first : _selected!,
      );
    });
  }

  bool _sameKeys(List<Service> incoming) {
    final a = incoming.where((s) => s.active).map((s) => s.key).toList()..sort();
    final b = _services.map((s) => s.key).toList()..sort();
    return a.length == b.length && List.generate(a.length, (i) => a[i] == b[i]).every((x) => x);
  }
}
