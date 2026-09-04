import 'package:flutter/material.dart';
import 'package:hc_core/hc_core.dart';

import '../services.dart';
import 'home_screen.dart';

/// Phone + access-code sign-in for a client.
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
      final rec = await widget.services.repo.clientByPhone(_phone.text.trim());
      if (rec == null) {
        throw StateError('No client with that number. Contact admin.');
      }
      final session = await widget.services.auth
          .signInClientWithCode(rec, _code.text.trim());

      // register for push, store token
      widget.services.notifications.register().then((token) {
        if (token != null) {
          widget.services.repo.saveClient(rec.copyWith(fcmToken: token));
        }
      });

      if (!mounted) return;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
        builder: (_) => HomeScreen(services: widget.services, client: rec, session: session),
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
      appBar: AppBar(title: const Text('HomeCare — Sign in')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 12),
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Mobile number', hintText: '+91 90000 00000'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _code,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Access code (from admin)'),
            ),
            const SizedBox(height: 20),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            FilledButton(
              onPressed: _busy ? null : _signIn,
              child: _busy
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Sign in'),
            ),
            const SizedBox(height: 12),
            const Text('New here? Ask the admin to register you and share your access code.',
                textAlign: TextAlign.center, style: TextStyle(color: Colors.black54)),
          ],
        ),
      ),
    );
  }
}
