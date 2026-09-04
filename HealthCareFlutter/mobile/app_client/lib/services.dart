import 'package:hc_core/hc_core.dart';

/// Simple service bundle passed down the widget tree.
class AppServices {
  final Repositories repo;
  final AuthService auth;
  final LifecycleService lifecycle;
  final TrackingService tracking;
  final NotificationService notifications;
  final ServicesRepository services;
  final SettingsService settings;

  AppServices({
    required this.repo,
    required this.auth,
    required this.lifecycle,
    required this.tracking,
    required this.notifications,
    required this.services,
    required this.settings,
  });
}
