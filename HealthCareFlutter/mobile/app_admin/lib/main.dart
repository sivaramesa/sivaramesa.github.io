import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:hc_core/hc_core.dart';

import 'firebase_options.dart';
import 'screens/dashboard_screen.dart';
import 'services.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  final db = FirebaseFirestore.instance;
  final repo = Repositories(db);
  final payments = PaymentsService(provider: 'mock');
  final services = AppServices(
    repo: repo,
    auth: AuthService(FirebaseAuth.instance),
    lifecycle: LifecycleService(repo: repo, payments: payments),
    payments: payments,
    services: ServicesRepository(db),
    settings: SettingsService(db),
  );

  runApp(AdminApp(services: services));
}

class AdminApp extends StatelessWidget {
  final AppServices services;
  const AdminApp({super.key, required this.services});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'HomeCare — Admin',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: const Color(0xFF1A73E8), useMaterial3: true),
      home: _AdminGate(services: services),
    );
  }
}

/// Minimal admin gate — signs in anonymously then shows the dashboard.
class _AdminGate extends StatefulWidget {
  final AppServices services;
  const _AdminGate({required this.services});

  @override
  State<_AdminGate> createState() => _AdminGateState();
}

class _AdminGateState extends State<_AdminGate> {
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    widget.services.auth.signInAdmin('admin').then((_) {
      if (mounted) setState(() => _ready = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return DashboardScreen(services: widget.services);
  }
}
