import 'package:flutter/material.dart';
import 'package:hc_core/hc_core.dart';

import '../services.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  final AppServices services;
  const LoginScreen({super.key, required this.services});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    setState(() { _busy = true; _error = null; });
    try {
      final rec = await widget.services.repo.caregiverByPhone(_phone.text.trim());
      if (rec == null) throw StateError('No caregiver with that number. Contact admin.');
      final session = await widget.services.auth.signInCaregiverWithCode(rec, _code.text.trim());
      widget.services.notifications.register().then((token) {
        if (token != null) widget.services.repo.saveCaregiver(rec.copyWith(fcmToken: token));
      });
      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => HomeScreen(services: widget.services, caregiverId: rec.id, session: session),
      ));
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Bad state: ', ''));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('HomeCare Caregiver — Sign in')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 12),
            TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Mobile number')),
            const SizedBox(height: 12),
            TextField(controller: _code, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Access code (from admin)')),
            const SizedBox(height: 20),
            if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_error!, style: const TextStyle(color: Colors.red))),
            FilledButton(
              onPressed: _busy ? null : _signIn,
              child: _busy ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Sign in'),
            ),
          ],
        ),
      ),
    );
  }
}
