import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:hc_core/hc_core.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../services.dart';

/// Admin dashboard — the middle-man view. Five tabs: Dashboard, Clients,
/// Caregivers, Payments, Reports. Admin sees everything, including all secret
/// codes (requirements 1, 2, 5, and payment/report duties).
class DashboardScreen extends StatefulWidget {
  final AppServices services;
  const DashboardScreen({super.key, required this.services});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  @override
  void initState() {
    super.initState();
    // migrate the six original specialities into the Services master (idempotent)
    widget.services.services.seedDefaults();
  }

  @override
  Widget build(BuildContext context) {
    final services = widget.services;
    return DefaultTabController(
      length: 6,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('HomeCare Admin'),
          bottom: const TabBar(isScrollable: true, tabs: [
            Tab(text: 'Dashboard'),
            Tab(text: 'Services'),
            Tab(text: 'Clients'),
            Tab(text: 'Caregivers'),
            Tab(text: 'Payments'),
            Tab(text: 'Reports'),
          ]),
        ),
        body: TabBarView(children: [
          _DashboardTab(services: services),
          _ServicesTab(services: services),
          _ClientsTab(services: services),
          _CaregiversTab(services: services),
          _PaymentsTab(services: services),
          _ReportsTab(services: services),
        ]),
      ),
    );
  }
}

String labelize(String s) => s
    .replaceAll('_', ' ')
    .split(' ')
    .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
    .join(' ');

// Statuses meaning "a caregiver committed but service not started yet".
const _notStarted = [BookingStatus.accepted, BookingStatus.enRoute, BookingStatus.arrived];

/// Is this booking accepted-but-not-started within the at-risk window (or past)?
({bool atRisk, int? minutesLeft}) startRiskInfo(Booking b, int startAlertMinutes) {
  if (!_notStarted.contains(b.status) || b.scheduledAt == null) return (atRisk: false, minutesLeft: null);
  final t = DateTime.tryParse(b.scheduledAt!);
  if (t == null) return (atRisk: false, minutesLeft: null);
  final msLeft = t.difference(DateTime.now()).inMilliseconds;
  final minutesLeft = (msLeft / 60000).round();
  if (msLeft > startAlertMinutes * 60000) return (atRisk: false, minutesLeft: minutesLeft);
  return (atRisk: true, minutesLeft: minutesLeft);
}

// ── Dashboard: all bookings + all secret codes ──────────────────────────────
class _DashboardTab extends StatefulWidget {
  final AppServices services;
  const _DashboardTab({required this.services});
  @override
  State<_DashboardTab> createState() => _DashboardTabState();
}

class _DashboardTabState extends State<_DashboardTab> {
  bool _includeCompleted = false;
  bool _atRiskOnly = false;
  AppSettings _settings = const AppSettings();
  List<Caregiver> _caregivers = const [];

  @override
  void initState() {
    super.initState();
    widget.services.settings.stream().listen((s) { if (mounted) setState(() => _settings = s); });
    widget.services.repo.caregiversStream().listen((l) { if (mounted) setState(() => _caregivers = l); });
  }

  AppServices get services => widget.services;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Booking>>(
      stream: services.repo.bookingsStream(),
      builder: (context, snap) {
        final bookings = (snap.data ?? const <Booking>[])
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
        final active = bookings.where((b) => b.isActive).length;
        final done = bookings.where((b) => b.status == BookingStatus.completed).toList();
        final revenue = done.fold<double>(0, (s, b) => s + b.price);
        final atRiskTotal = bookings.where((b) => startRiskInfo(b, _settings.startAlertMinutes).atRisk).length;

        var rows = _includeCompleted
            ? bookings
            : bookings.where((b) => b.status != BookingStatus.completed).toList();
        if (_atRiskOnly) rows = rows.where((b) => startRiskInfo(b, _settings.startAlertMinutes).atRisk).toList();

        return ListView(
          padding: const EdgeInsets.all(12),
          children: [
            _SettingsCard(services: services),
            const SizedBox(height: 8),
            Row(children: [
              _metric('Active', '$active'),
              _metric('Completed', '${done.length}'),
              _metric('Revenue', '₹${revenue.toStringAsFixed(0)}'),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              const Expanded(child: Text('All bookings', style: TextStyle(fontWeight: FontWeight.bold))),
              if (atRiskTotal > 0)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: Chip(
                    backgroundColor: const Color(0xFF3A1616),
                    label: Text('⏰ $atRiskTotal at risk', style: const TextStyle(color: Colors.white, fontSize: 12)),
                  ),
                ),
            ]),
            Row(children: [
              Expanded(
                child: CheckboxListTile(
                  dense: true, contentPadding: EdgeInsets.zero,
                  title: const Text('At-risk only', style: TextStyle(fontSize: 13)),
                  value: _atRiskOnly, onChanged: (v) => setState(() => _atRiskOnly = v ?? false),
                ),
              ),
              Expanded(
                child: CheckboxListTile(
                  dense: true, contentPadding: EdgeInsets.zero,
                  title: const Text('Include completed', style: TextStyle(fontSize: 13)),
                  value: _includeCompleted, onChanged: (v) => setState(() => _includeCompleted = v ?? false),
                ),
              ),
            ]),
            for (final b in rows) _bookingCard(b),
          ],
        );
      },
    );
  }

  Color? _rowColor(Booking b) {
    if (startRiskInfo(b, _settings.startAlertMinutes).atRisk) return const Color(0xFF3A1616);
    if (b.priority) return const Color(0xFF3A2A12);
    if (b.clonedFrom != null) return const Color(0xFF12283A);
    return null;
  }

  Widget _bookingCard(Booking b) {
    final risk = startRiskInfo(b, _settings.startAlertMinutes);
    final badges = <Widget>[
      if (b.priority) const _Pill('⚡ Priority', Color(0xFFEF6C00)),
      if (b.clonedFrom != null) const _Pill('↻ Rebooked', Color(0xFF1565C0)),
      if (b.invitedCaregiverIds.isNotEmpty) _Pill('★ Invited ${b.invitedCaregiverIds.length}', const Color(0xFF2E7D32)),
      if (risk.atRisk)
        _Pill(risk.minutesLeft != null && risk.minutesLeft! < 0 ? '⏰ Overdue ${-risk.minutesLeft!}m' : '⏰ ${risk.minutesLeft}m left', const Color(0xFFC62828)),
    ];
    final canCancel = ![BookingStatus.completed, BookingStatus.cancelled].contains(b.status);
    final canInvite = [BookingStatus.broadcast, BookingStatus.paid].contains(b.status);
    return Card(
      color: _rowColor(b),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (badges.isNotEmpty) Wrap(spacing: 6, runSpacing: 4, children: badges),
            const SizedBox(height: 4),
            Text('${labelize(b.speciality)} · ₹${b.price.toStringAsFixed(0)} · ${labelize(b.status)}',
                style: const TextStyle(fontWeight: FontWeight.bold)),
            Text('Booked ${_fmt(b.createdAt)}'
                '${b.scheduledAt != null ? ' · Scheduled ${_fmt(b.scheduledAt!)}' : ''}',
                style: const TextStyle(fontSize: 12)),
            Text('Caregiver: ${b.caregiverName ?? '—'} · Payment: ${labelize(b.payment.status)}',
                style: const TextStyle(fontSize: 12)),
            Text('Start ${b.codes.startCode ?? '—'}${b.codes.startVerified ? '✓' : ''} · '
                'Complete ${b.codes.completeCode ?? '—'}${b.codes.completeVerified ? '✓' : ''}',
                style: const TextStyle(fontSize: 11, color: Colors.grey)),
            if (b.status == BookingStatus.cancelled && b.cancelReason != null)
              Text('Cancelled: ${b.cancelReason} (${b.cancelledBy ?? '—'})', style: const TextStyle(fontSize: 11, color: Colors.orangeAccent)),
            const SizedBox(height: 6),
            Wrap(spacing: 6, children: [
              OutlinedButton(onPressed: () => _editBooking(b), child: const Text('Edit')),
              if (canInvite) OutlinedButton(onPressed: () => _findCaregivers(b), child: const Text('Find caregivers')),
              if (canCancel) OutlinedButton(onPressed: () => _cancelBooking(b), child: const Text('Cancel')),
            ]),
          ],
        ),
      ),
    );
  }

  Future<void> _editBooking(Booking b) => showDialog(context: context, builder: (_) => _EditBookingDialog(services: services, booking: b));

  Future<void> _cancelBooking(Booking b) => showDialog(context: context, builder: (_) => _CancelBookingDialog(services: services, booking: b, settings: _settings, onRebookInvite: _findCaregiversById));

  Future<void> _findCaregivers(Booking b) => showDialog(context: context, builder: (_) => _InviteDialog(services: services, booking: b, caregivers: _caregivers, settings: _settings));

  Future<void> _findCaregiversById(String id) async {
    final b = await services.repo.getBooking(id);
    if (b != null && mounted) _findCaregivers(b);
  }

  Widget _metric(String label, String value) => Expanded(
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(children: [
              Text(label, style: const TextStyle(color: Colors.black54)),
              const SizedBox(height: 4),
              Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
            ]),
          ),
        ),
      );
}

class _Pill extends StatelessWidget {
  final String text;
  final Color color;
  const _Pill(this.text, this.color);
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(999)),
        child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600)),
      );
}

// ── Clients (confidential) ───────────────────────────────────────────────────
class _ClientsTab extends StatefulWidget {
  final AppServices services;
  const _ClientsTab({required this.services});
  @override
  State<_ClientsTab> createState() => _ClientsTabState();
}

class _ClientsTabState extends State<_ClientsTab> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _code = TextEditingController();
  final _locLabel = TextEditingController(text: 'Home');
  final _locAddr = TextEditingController();

  Future<void> _add() async {
    if (_name.text.trim().isEmpty || _phone.text.trim().isEmpty) return;
    final code = _code.text.trim().isEmpty
        ? (100000 + DateTime.now().millisecond * 7 % 900000).toString()
        : _code.text.trim();
    final c = Client(
      id: 'cli_${DateTime.now().millisecondsSinceEpoch}',
      name: _name.text.trim(),
      phone: _phone.text.trim(),
      email: _email.text.trim(),
      accessCode: code,
      savedLocations: _locAddr.text.trim().isEmpty
          ? const []
          : [HcLocation(label: _locLabel.text.trim(), address: _locAddr.text.trim())],
    );
    await widget.services.repo.saveClient(c);
    _name.clear(); _phone.clear(); _email.clear(); _code.clear(); _locAddr.clear();
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Client added · code $code')));
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        const Text('Register client', style: TextStyle(fontWeight: FontWeight.bold)),
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full name')),
        TextField(controller: _phone, decoration: const InputDecoration(labelText: 'Phone')),
        TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email (optional)')),
        TextField(controller: _code, decoration: const InputDecoration(labelText: 'Access code (blank = auto)')),
        TextField(controller: _locLabel, decoration: const InputDecoration(labelText: 'Location label')),
        TextField(controller: _locAddr, decoration: const InputDecoration(labelText: 'Address')),
        const SizedBox(height: 10),
        FilledButton(onPressed: _add, child: const Text('Add client')),
        const Divider(height: 28),
        const Text('Clients (confidential)', style: TextStyle(fontWeight: FontWeight.bold)),
        StreamBuilder<List<Client>>(
          stream: widget.services.repo.clientsStream(),
          builder: (context, snap) {
            final list = snap.data ?? const <Client>[];
            return Column(children: [
              for (final c in list)
                Card(
                  child: ListTile(
                    title: Text(c.name),
                    subtitle: Text('${c.phone} · code ${c.accessCode ?? '—'}\n'
                        '${c.savedLocations.map((l) => '${l.label}: ${l.address}').join('; ')}'),
                    isThreeLine: true,
                    trailing: IconButton(
                      icon: const Icon(Icons.delete, color: Colors.red),
                      onPressed: () => widget.services.repo.deleteClient(c.id),
                    ),
                  ),
                ),
            ]);
          },
        ),
      ],
    );
  }
}

// ── Caregivers ────────────────────────────────────────────────────────────────
class _CaregiversTab extends StatefulWidget {
  final AppServices services;
  const _CaregiversTab({required this.services});
  @override
  State<_CaregiversTab> createState() => _CaregiversTabState();
}

class _CaregiversTabState extends State<_CaregiversTab> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final Set<String> _specs = {};
  String? _photo; // base64 data captured for the new caregiver

  Future<void> _pickPhoto() async {
    final picker = ImagePicker();
    final file = await picker.pickImage(source: ImageSource.gallery, maxWidth: 256, maxHeight: 256, imageQuality: 80);
    if (file == null) return;
    final bytes = await file.readAsBytes();
    setState(() => _photo = 'data:image/jpeg;base64,${base64Encode(bytes)}');
  }

  Future<void> _add() async {
    if (_name.text.trim().isEmpty || _phone.text.trim().isEmpty || _specs.isEmpty) return;
    final code = _code.text.trim().isEmpty
        ? (100000 + DateTime.now().millisecond * 7 % 900000).toString()
        : _code.text.trim();
    final cg = Caregiver(
      id: 'cg_${DateTime.now().millisecondsSinceEpoch}',
      name: _name.text.trim(),
      phone: _phone.text.trim(),
      specialities: _specs.toList(),
      accessCode: code,
      photo: _photo,
    );
    await widget.services.repo.saveCaregiver(cg);
    _name.clear(); _phone.clear(); _code.clear();
    setState(() { _specs.clear(); _photo = null; });
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Caregiver added · code $code')));
  }

  Widget _photoPreview() {
    if (_photo == null) return const SizedBox.shrink();
    try {
      final b64 = _photo!.split(',').last;
      return Padding(
        padding: const EdgeInsets.only(top: 8),
        child: CircleAvatar(radius: 32, backgroundImage: MemoryImage(base64Decode(b64))),
      );
    } catch (_) {
      return const SizedBox.shrink();
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        const Text('Register caregiver', style: TextStyle(fontWeight: FontWeight.bold)),
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full name')),
        TextField(controller: _phone, decoration: const InputDecoration(labelText: 'Phone')),
        TextField(controller: _code, decoration: const InputDecoration(labelText: 'Access code (blank = auto)')),
        const SizedBox(height: 8),
        Wrap(spacing: 8, children: [
          for (final s in Speciality.all)
            FilterChip(
              label: Text(labelize(s)),
              selected: _specs.contains(s),
              onSelected: (v) => setState(() => v ? _specs.add(s) : _specs.remove(s)),
            ),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          OutlinedButton.icon(
            onPressed: _pickPhoto,
            icon: const Icon(Icons.photo_camera),
            label: const Text('Photo (identity proof)'),
          ),
          _photoPreview(),
        ]),
        const SizedBox(height: 10),
        FilledButton(onPressed: _add, child: const Text('Add caregiver')),
        const Divider(height: 28),
        const Text('Caregivers (public profiles)', style: TextStyle(fontWeight: FontWeight.bold)),
        StreamBuilder<List<Caregiver>>(
          stream: widget.services.repo.caregiversStream(),
          builder: (context, snap) {
            final list = snap.data ?? const <Caregiver>[];
            return Column(children: [
              for (final c in list)
                Card(
                  child: ListTile(
                    title: Text('${c.name}  ·  ★ ${c.rating} (${c.ratingCount})'),
                    subtitle: Text('${c.phone} · ${labelize(c.availability)} · code ${c.accessCode ?? '—'}\n'
                        '${c.specialities.map(labelize).join(', ')}'),
                    isThreeLine: true,
                    trailing: IconButton(
                      icon: const Icon(Icons.delete, color: Colors.red),
                      onPressed: () => widget.services.repo.deleteCaregiver(c.id),
                    ),
                  ),
                ),
            ]);
          },
        ),
      ],
    );
  }
}

// ── Payments ──────────────────────────────────────────────────────────────────
class _PaymentsTab extends StatelessWidget {
  final AppServices services;
  const _PaymentsTab({required this.services});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Service>>(
      stream: services.services.stream(),
      builder: (context, svcSnap) {
        final svcList = svcSnap.data ?? const <Service>[];
        return StreamBuilder<List<Booking>>(
      stream: services.repo.bookingsStream(),
      builder: (context, snap) {
        final paid = (snap.data ?? const <Booking>[])
            .where((b) => b.payment.status != 'unpaid')
            .toList();
        return ListView(
          padding: const EdgeInsets.all(12),
          children: [
            const Text('Payments — receive from clients, pay out caregivers',
                style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            for (final b in paid)
              Builder(builder: (context) {
                final split = services.payments.commissionSplit(b.price, commissionFractionFor(b, svcList));
                final canRelease = b.status == BookingStatus.completed && b.payment.status == 'paid';
                final released = b.payment.status == 'released';
                return Card(
                  child: ListTile(
                    title: Text('Booking ${b.id.substring(b.id.length - 6)} · ₹${b.price.toStringAsFixed(0)}'),
                    subtitle: Text('Client→Platform: ${labelize(b.payment.status)}\n'
                        'Caregiver share: ₹${split.caregiverAmount.toStringAsFixed(0)}'),
                    isThreeLine: true,
                    trailing: released
                        ? const Chip(label: Text('Released'))
                        : canRelease
                            ? FilledButton(
                                onPressed: () => services.lifecycle.releasePayout(b),
                                child: const Text('Release'))
                            : const Text('after completion'),
                  ),
                );
              }),
          ],
        );
      },
    );
      },
    );
  }
}

// ── Reports (daily + date range) ─────────────────────────────────────────────
class _ReportsTab extends StatefulWidget {
  final AppServices services;
  const _ReportsTab({required this.services});
  @override
  State<_ReportsTab> createState() => _ReportsTabState();
}

class _ReportsTabState extends State<_ReportsTab> {
  DateTime _from = DateTime.now();
  DateTime _to = DateTime.now();

  @override
  Widget build(BuildContext context) {
    final startIso = DateTime.utc(_from.year, _from.month, _from.day).toIso8601String();
    final endIso = DateTime.utc(_to.year, _to.month, _to.day, 23, 59, 59).toIso8601String();

    return StreamBuilder<List<Service>>(
      stream: widget.services.services.stream(),
      builder: (context, svcSnap) {
        final svcList = svcSnap.data ?? const <Service>[];
        return StreamBuilder<List<Booking>>(
      stream: widget.services.repo.bookingsStream(),
      builder: (context, snap) {
        final all = snap.data ?? const <Booking>[];
        final inRange = all.where((b) => b.createdAt.compareTo(startIso) >= 0 && b.createdAt.compareTo(endIso) <= 0).toList();
        final done = inRange.where((b) => b.status == BookingStatus.completed).toList();
        final gross = done.fold<double>(0, (s, b) => s + b.price);
        var commission = 0.0, payout = 0.0, ratingSum = 0.0, ratingN = 0;
        for (final b in done) {
          final sp = widget.services.payments.commissionSplit(b.price, commissionFractionFor(b, svcList));
          commission += sp.commission;
          payout += sp.caregiverAmount;
          if (b.feedback.stars != null) { ratingSum += b.feedback.stars!; ratingN++; }
        }

        return ListView(
          padding: const EdgeInsets.all(12),
          children: [
            Row(children: [
              Expanded(child: OutlinedButton(onPressed: () => _pick(true), child: Text('From: ${_d(_from)}'))),
              const SizedBox(width: 8),
              Expanded(child: OutlinedButton(onPressed: () => _pick(false), child: Text('To: ${_d(_to)}'))),
            ]),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              _stat('Bookings', '${inRange.length}'),
              _stat('Completed', '${done.length}'),
              _stat('Gross', '₹${gross.toStringAsFixed(0)}'),
              _stat('Commission', '₹${commission.toStringAsFixed(0)}'),
              _stat('Paid out', '₹${payout.toStringAsFixed(0)}'),
              _stat('Avg rating', ratingN == 0 ? '—' : (ratingSum / ratingN).toStringAsFixed(1)),
            ]),
            const Divider(height: 24),
            for (final b in inRange)
              ListTile(
                dense: true,
                title: Text('${labelize(b.speciality)} · ₹${b.price.toStringAsFixed(0)}'),
                subtitle: Text('${_fmt(b.createdAt)} · ${labelize(b.status)}'),
                trailing: Text(b.feedback.stars != null ? '★ ${b.feedback.stars}' : '—'),
              ),
          ],
        );
      },
    );
      },
    );
  }

  Future<void> _pick(bool isFrom) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isFrom ? _from : _to,
      firstDate: DateTime(2024),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => isFrom ? _from = picked : _to = picked);
  }

  Widget _stat(String label, String value) => SizedBox(
        width: 150,
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(children: [
              Text(label, style: const TextStyle(color: Colors.black54)),
              Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
            ]),
          ),
        ),
      );

  String _d(DateTime d) => DateFormat('yyyy-MM-dd').format(d);
}

String _fmt(String iso) {
  try {
    return DateFormat('MMM d, HH:mm').format(DateTime.parse(iso).toLocal());
  } catch (_) {
    return iso;
  }
}

// ── Platform settings card (on the Dashboard tab) ────────────────────────────
class _SettingsCard extends StatefulWidget {
  final AppServices services;
  const _SettingsCard({required this.services});
  @override
  State<_SettingsCard> createState() => _SettingsCardState();
}

class _SettingsCardState extends State<_SettingsCard> {
  AppSettings? _s;
  final _radius = TextEditingController();
  final _lead = TextEditingController();
  final _priorityValue = TextEditingController();
  final _startAlert = TextEditingController();
  final _reasons = TextEditingController();

  @override
  void initState() {
    super.initState();
    widget.services.settings.stream().listen((s) {
      if (!mounted) return;
      // only refill controllers the first time to avoid clobbering edits
      final first = _s == null;
      setState(() => _s = s);
      if (first) {
        _radius.text = s.verifyRadiusMeters.toStringAsFixed(0);
        _lead.text = s.bookingLeadHours.toString();
        _priorityValue.text = s.priorityValue.toString();
        _startAlert.text = s.startAlertMinutes.toString();
        _reasons.text = s.cancelReasons.join('\n');
      }
    });
  }

  Future<void> _save() async {
    final s = _s!;
    final reasons = _reasons.text.split('\n').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
    await widget.services.settings.update(s.copyWith(
      verifyRadiusMeters: (double.tryParse(_radius.text) ?? 50).clamp(10, 100000),
      bookingLeadHours: int.tryParse(_lead.text) ?? 4,
      priorityValue: double.tryParse(_priorityValue.text) ?? 1.5,
      startAlertMinutes: int.tryParse(_startAlert.text) ?? 30,
      cancelReasons: reasons.isEmpty ? s.cancelReasons : reasons,
    ));
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Settings saved')));
  }

  @override
  Widget build(BuildContext context) {
    final s = _s;
    if (s == null) return const SizedBox.shrink();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Platform settings', style: TextStyle(fontWeight: FontWeight.bold)),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Require caregiver location verification'),
            value: s.locationVerification,
            onChanged: (v) => widget.services.settings.update(s.copyWith(locationVerification: v)),
          ),
          Row(children: [
            Expanded(child: TextField(controller: _radius, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Verify range (m)'))),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _lead, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Lead hours'))),
          ]),
          Row(children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: s.priorityMode,
                decoration: const InputDecoration(labelText: 'Priority mode'),
                items: PriorityMode.all.map((m) => DropdownMenuItem(value: m, child: Text(m))).toList(),
                onChanged: (v) => widget.services.settings.update(s.copyWith(priorityMode: v)),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _priorityValue, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Priority value'))),
          ]),
          Row(children: [
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: s.matchLocationMode,
                decoration: const InputDecoration(labelText: 'Match location'),
                items: const [
                  DropdownMenuItem(value: MatchLocationMode.gps, child: Text('Current GPS')),
                  DropdownMenuItem(value: MatchLocationMode.registered, child: Text('Registered')),
                  DropdownMenuItem(value: MatchLocationMode.both, child: Text('Either in range')),
                ],
                onChanged: (v) => widget.services.settings.update(s.copyWith(matchLocationMode: v)),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(child: TextField(controller: _startAlert, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Start-risk min'))),
          ]),
          const SizedBox(height: 8),
          TextField(controller: _reasons, maxLines: 3, decoration: const InputDecoration(labelText: 'Cancellation reasons (one per line)')),
          const SizedBox(height: 8),
          Align(alignment: Alignment.centerRight, child: FilledButton(onPressed: _save, child: const Text('Save settings'))),
        ]),
      ),
    );
  }
}

// ── Edit booking dialog (service/schedule/price/radius/priority/status/payment) ─
class _EditBookingDialog extends StatefulWidget {
  final AppServices services;
  final Booking booking;
  const _EditBookingDialog({required this.services, required this.booking});
  @override
  State<_EditBookingDialog> createState() => _EditBookingDialogState();
}

class _EditBookingDialogState extends State<_EditBookingDialog> {
  late final _price = TextEditingController(text: widget.booking.price.toStringAsFixed(0));
  late final _radius = TextEditingController(text: (widget.booking.radiusKm ?? 15).toStringAsFixed(0));
  late String _status = widget.booking.status;
  late String _payment = widget.booking.payment.status;
  late bool _priority = widget.booking.priority;
  bool _busy = false;

  static const _statuses = [
    BookingStatus.created, BookingStatus.paid, BookingStatus.broadcast, BookingStatus.accepted,
    BookingStatus.enRoute, BookingStatus.arrived, BookingStatus.inService, BookingStatus.completionPending,
    BookingStatus.completed, BookingStatus.cancelled, BookingStatus.expired,
  ];
  static const _payments = ['unpaid', 'paid', 'released', 'refunded', 'transferred'];

  Future<void> _save() async {
    setState(() => _busy = true);
    var payStatus = _payment;
    if (_status == BookingStatus.paid && payStatus == 'unpaid') payStatus = 'paid';
    final b = widget.booking;
    final payment = b.payment.copyWith(
      status: payStatus,
      paidAt: (payStatus == 'paid' && b.payment.paidAt == null) ? nowIso() : b.payment.paidAt,
    );
    final updated = b.copyWith(
      status: _status,
      payment: payment,
      history: [...b.history, {'status': _status, 'at': nowIso(), 'by': 'admin-edit'}],
    );
    // price/radius/priority live outside copyWith's whitelist, so rebuild via map
    final map = updated.toMap();
    map['price'] = double.tryParse(_price.text) ?? b.price;
    map['radiusKm'] = double.tryParse(_radius.text) ?? b.radiusKm;
    map['priority'] = _priority;
    await widget.services.repo.saveBooking(Booking.fromMap(map));
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('Edit ${widget.booking.id.substring(widget.booking.id.length - 6)}'),
      content: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: _price, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Price (₹)')),
          TextField(controller: _radius, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Match radius (km)')),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Priority'), value: _priority, onChanged: (v) => setState(() => _priority = v)),
          DropdownButtonFormField<String>(
            initialValue: _status, decoration: const InputDecoration(labelText: 'Status'),
            items: _statuses.map((s) => DropdownMenuItem(value: s, child: Text(labelize(s)))).toList(),
            onChanged: (v) => setState(() => _status = v ?? _status),
          ),
          DropdownButtonFormField<String>(
            initialValue: _payment, decoration: const InputDecoration(labelText: 'Payment status'),
            items: _payments.map((s) => DropdownMenuItem(value: s, child: Text(labelize(s)))).toList(),
            onChanged: (v) => setState(() => _payment = v ?? _payment),
          ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Save changes')),
      ],
    );
  }
}

// ── Cancel dialog with reason picker + rebook checkbox ───────────────────────
class _CancelBookingDialog extends StatefulWidget {
  final AppServices services;
  final Booking booking;
  final AppSettings settings;
  final Future<void> Function(String bookingId) onRebookInvite;
  const _CancelBookingDialog({required this.services, required this.booking, required this.settings, required this.onRebookInvite});
  @override
  State<_CancelBookingDialog> createState() => _CancelBookingDialogState();
}

class _CancelBookingDialogState extends State<_CancelBookingDialog> {
  late String _reason = widget.settings.cancelReasons.isNotEmpty ? widget.settings.cancelReasons.first : '__other__';
  final _other = TextEditingController();
  bool _rebook = false;
  bool _busy = false;

  Future<void> _confirm() async {
    final isOther = _reason == '__other__';
    final reason = isOther ? _other.text.trim() : _reason;
    if (isOther && reason.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please specify the reason.')));
      return;
    }
    setState(() => _busy = true);
    final b = widget.booking;
    try {
      if (_rebook) {
        final leadHours = widget.settings.bookingLeadHours;
        final minScheduledAt = DateTime.now().add(Duration(hours: leadHours)).toUtc().toIso8601String();
        final fresh = widget.services.lifecycle.cloneBooking(b, rebook: true, minScheduledAt: minScheduledAt);
        final wasPaid = b.payment.status == 'paid' || b.payment.status == 'released';
        await widget.services.lifecycle.cancel(b, reason: reason, reasonCode: isOther ? 'Other' : _reason, by: 'admin', transferToRebook: wasPaid, toBookingId: fresh.id);
        await widget.services.repo.saveBooking(fresh);
        try {
          final all = await widget.services.repo.allCaregivers();
          await widget.services.lifecycle.broadcast(fresh, all, fresh.radiusKm, widget.settings.matchLocationMode);
        } catch (_) {}
        if (mounted) {
          Navigator.pop(context);
          await widget.onRebookInvite(fresh.id);
        }
      } else {
        await widget.services.lifecycle.cancel(b, reason: reason, reasonCode: isOther ? 'Other' : _reason, by: 'admin');
        if (mounted) Navigator.pop(context);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final paid = widget.booking.payment.status == 'paid';
    return AlertDialog(
      title: Text('Cancel ${widget.booking.id.substring(widget.booking.id.length - 6)}'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(paid ? '₹${widget.booking.price.toStringAsFixed(0)} will be refunded (or transferred on rebook).' : 'A payment revision will be recorded.'),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          initialValue: _reason, decoration: const InputDecoration(labelText: 'Reason'),
          items: [
            for (final r in widget.settings.cancelReasons) DropdownMenuItem(value: r, child: Text(r)),
            const DropdownMenuItem(value: '__other__', child: Text('Other (free text)')),
          ],
          onChanged: (v) => setState(() => _reason = v ?? _reason),
        ),
        if (_reason == '__other__') TextField(controller: _other, decoration: const InputDecoration(labelText: 'Please specify')),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Rebook — new request (keeps paid status)', style: TextStyle(fontSize: 13)),
          value: _rebook, onChanged: (v) => setState(() => _rebook = v ?? false),
        ),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Keep booking')),
        FilledButton(onPressed: _busy ? null : _confirm, child: const Text('Confirm cancellation')),
      ],
    );
  }
}

// ── Find & invite caregivers dialog (local radius + mode overrides) ──────────
class _InviteDialog extends StatefulWidget {
  final AppServices services;
  final Booking booking;
  final List<Caregiver> caregivers;
  final AppSettings settings;
  const _InviteDialog({required this.services, required this.booking, required this.caregivers, required this.settings});
  @override
  State<_InviteDialog> createState() => _InviteDialogState();
}

class _InviteDialogState extends State<_InviteDialog> {
  late double _radius = widget.booking.radiusKm ?? 10;
  late String _mode = widget.settings.matchLocationMode;
  bool _includeOffline = false;
  late final Set<String> _selected = {...widget.booking.invitedCaregiverIds};
  bool _busy = false;

  List<({Caregiver cg, double dist})> _matches() {
    final b = widget.booking;
    var list = widget.caregivers.where((c) =>
        c.status != 'registered' && c.specialities.contains(b.speciality));
    if (!_includeOffline) list = list.where((c) => c.availability == Availability.available);
    final withDist = list
        .map((c) => (cg: c, dist: Geo.caregiverDistanceKm(c, b.location, _mode)))
        .where((x) => x.dist <= _radius)
        .toList()
      ..sort((a, b2) => a.dist.compareTo(b2.dist));
    return withDist;
  }

  Future<void> _link() async {
    if (_selected.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Pick at least one caregiver.')));
      return;
    }
    setState(() => _busy = true);
    final b = await widget.services.repo.getBooking(widget.booking.id) ?? widget.booking;
    final updated = b.copyWith(invitedCaregiverIds: _selected.toList());
    await widget.services.repo.saveBooking(updated);
    if (mounted) {
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Linked ${_selected.length} caregiver(s).')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final matches = _matches();
    return AlertDialog(
      title: Text('Find caregivers · ${labelize(widget.booking.speciality)}'),
      content: SizedBox(
        width: 420,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Radius (km)', style: TextStyle(fontSize: 12)),
                Slider(value: _radius.clamp(1, 100), min: 1, max: 100, divisions: 99, label: _radius.toStringAsFixed(0), onChanged: (v) => setState(() => _radius = v)),
              ]),
            ),
            Expanded(
              child: DropdownButtonFormField<String>(
                initialValue: _mode, decoration: const InputDecoration(labelText: 'Match by', isDense: true),
                items: const [
                  DropdownMenuItem(value: MatchLocationMode.gps, child: Text('GPS')),
                  DropdownMenuItem(value: MatchLocationMode.registered, child: Text('Registered')),
                  DropdownMenuItem(value: MatchLocationMode.both, child: Text('Either')),
                ],
                onChanged: (v) => setState(() => _mode = v ?? _mode),
              ),
            ),
          ]),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero, dense: true,
            title: const Text('Include offline (last-seen/registered)', style: TextStyle(fontSize: 12)),
            value: _includeOffline, onChanged: (v) => setState(() => _includeOffline = v ?? false),
          ),
          Row(children: [
            Text('${matches.length} match(es)', style: const TextStyle(fontSize: 12)),
            const Spacer(),
            TextButton(
              onPressed: () => setState(() {
                if (matches.every((m) => _selected.contains(m.cg.id))) {
                  for (final m in matches) { _selected.remove(m.cg.id); }
                } else {
                  for (final m in matches) { _selected.add(m.cg.id); }
                }
              }),
              child: const Text('Select all shown'),
            ),
          ]),
          SizedBox(
            height: 260,
            child: ListView(
              children: [
                for (final m in matches)
                  CheckboxListTile(
                    dense: true,
                    value: _selected.contains(m.cg.id),
                    onChanged: (v) => setState(() => v == true ? _selected.add(m.cg.id) : _selected.remove(m.cg.id)),
                    title: Text('${m.cg.name} · ${labelize(m.cg.availability)}'),
                    subtitle: Text('${m.dist.isFinite ? '${m.dist.toStringAsFixed(1)} km' : 'n/a'} · ★ ${m.cg.rating}'),
                  ),
              ],
            ),
          ),
        ]),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
        FilledButton(onPressed: _busy ? null : _link, child: const Text('Link selected')),
      ],
    );
  }
}

// ── Services master tab ───────────────────────────────────────────────────────
class _ServicesTab extends StatefulWidget {
  final AppServices services;
  const _ServicesTab({required this.services});
  @override
  State<_ServicesTab> createState() => _ServicesTabState();
}

class _ServicesTabState extends State<_ServicesTab> {
  final _name = TextEditingController();
  final _cost = TextEditingController();
  final _commission = TextEditingController(text: '15');

  Future<void> _add() async {
    if (_name.text.trim().isEmpty) return;
    final svc = ServicesRepository.create(
      name: _name.text.trim(),
      cost: double.tryParse(_cost.text) ?? 0,
      commissionPct: double.tryParse(_commission.text) ?? 15,
    );
    await widget.services.services.save(svc);
    _name.clear(); _cost.clear(); _commission.text = '15';
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Service "${svc.name}" added')));
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        const Text('Add service', style: TextStyle(fontWeight: FontWeight.bold)),
        TextField(controller: _name, decoration: const InputDecoration(labelText: 'Service name')),
        Row(children: [
          Expanded(child: TextField(controller: _cost, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Default cost (₹)'))),
          const SizedBox(width: 10),
          Expanded(child: TextField(controller: _commission, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Commission %'))),
        ]),
        const SizedBox(height: 10),
        FilledButton(onPressed: _add, child: const Text('Add service')),
        const Divider(height: 28),
        const Text('Services', style: TextStyle(fontWeight: FontWeight.bold)),
        StreamBuilder<List<Service>>(
          stream: widget.services.services.stream(),
          builder: (context, snap) {
            final list = snap.data ?? const <Service>[];
            return Column(children: [for (final s in list) _ServiceRow(services: widget.services, service: s)]);
          },
        ),
      ],
    );
  }
}

class _ServiceRow extends StatefulWidget {
  final AppServices services;
  final Service service;
  const _ServiceRow({required this.services, required this.service});
  @override
  State<_ServiceRow> createState() => _ServiceRowState();
}

class _ServiceRowState extends State<_ServiceRow> {
  late final TextEditingController _cost = TextEditingController(text: widget.service.cost.toStringAsFixed(0));
  late final TextEditingController _commission = TextEditingController(text: widget.service.commissionPct.toStringAsFixed(0));
  late bool _active = widget.service.active;

  Future<void> _save() async {
    final updated = widget.service.copyWith(
      cost: double.tryParse(_cost.text) ?? widget.service.cost,
      commissionPct: double.tryParse(_commission.text) ?? widget.service.commissionPct,
      active: _active,
    );
    await widget.services.services.save(updated);
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Saved ${updated.name}')));
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${widget.service.name}  ·  ${widget.service.key}', style: const TextStyle(fontWeight: FontWeight.bold)),
            Row(children: [
              Expanded(child: TextField(controller: _cost, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Cost ₹'))),
              const SizedBox(width: 8),
              Expanded(child: TextField(controller: _commission, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Commission %'))),
            ]),
            Row(children: [
              Row(children: [
                Checkbox(value: _active, onChanged: (v) => setState(() => _active = v ?? true)),
                const Text('Active'),
              ]),
              const Spacer(),
              FilledButton(onPressed: _save, child: const Text('Save')),
              const SizedBox(width: 8),
              IconButton(
                icon: const Icon(Icons.delete, color: Colors.red),
                onPressed: () => widget.services.services.remove(widget.service.id),
              ),
            ]),
          ],
        ),
      ),
    );
  }
}
