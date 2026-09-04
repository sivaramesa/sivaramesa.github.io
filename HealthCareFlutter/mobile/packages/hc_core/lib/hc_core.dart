/// hc_core — shared domain model, lifecycle and services for the HomeCare
/// Flutter apps (client, caregiver, admin).
///
/// Mirrors the PWA's shared/ layer so both stacks read/write the same Firestore
/// documents and follow the same secret-code lifecycle.
library hc_core;

export 'src/config.dart';

export 'src/models/enums.dart';
export 'src/models/models.dart';

export 'src/util/codes.dart';
export 'src/util/geo.dart';

export 'src/services/repositories.dart';
export 'src/services/auth_service.dart';
export 'src/services/lifecycle_service.dart';
export 'src/services/payments_service.dart';
export 'src/services/tracking_service.dart';
export 'src/services/notification_service.dart';
export 'src/services/services_repository.dart';
export 'src/services/settings_service.dart';
