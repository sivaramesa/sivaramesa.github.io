import 'package:hc_core/hc_core.dart';

class AppServices {
  final Repositories repo;
  final AuthService auth;
  final LifecycleService lifecycle;
  final TrackingService tracking;
  final NotificationService notifications;
  final SettingsService settings;

  AppServices({
    required this.repo,
    required this.auth,
    required this.lifecycle,
    required this.tracking,
    required this.notifications,
    required this.settings,
  });
}
