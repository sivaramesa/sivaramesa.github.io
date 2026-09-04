import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:hc_core/hc_core.dart';

import 'firebase_options.dart';
import 'screens/login_screen.dart';
import 'services.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  final db = FirebaseFirestore.instance;
  final repo = Repositories(db);
  final tracking = TrackingService();
  final services = AppServices(
    repo: repo,
    auth: AuthService(FirebaseAuth.instance),
    lifecycle: LifecycleService(
      repo: repo,
      payments: PaymentsService(provider: 'mock'),
      tracking: tracking,
    ),
    tracking: tracking,
    notifications: NotificationService(),
    services: ServicesRepository(db),
    settings: SettingsService(db),
  );

  runApp(ClientApp(services: services));
}

final hcTheme = HcThemeController();

class ClientApp extends StatelessWidget {
  final AppServices services;
  const ClientApp({super.key, required this.services});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: hcTheme,
      builder: (context, _) => MaterialApp(
        title: 'HomeCare — Client',
        debugShowCheckedModeBanner: false,
        theme: hcTheme.light,
        darkTheme: hcTheme.dark,
        themeMode: hcTheme.mode,
        home: LoginScreen(services: services),
      ),
    );
  }
}
