import 'package:hc_core/hc_core.dart';

class AppServices {
  final Repositories repo;
  final AuthService auth;
  final LifecycleService lifecycle;
  final PaymentsService payments;
  final ServicesRepository services;
  final SettingsService settings;

  AppServices({
    required this.repo,
    required this.auth,
    required this.lifecycle,
    required this.payments,
    required this.services,
    required this.settings,
  });
}
