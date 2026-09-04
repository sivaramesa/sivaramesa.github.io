/// Domain model classes. Each has [toMap]/[fromMap] for Firestore, using the
/// same field names and string enums as the PWA so both stacks share documents.

import 'enums.dart';

String nowIso() => DateTime.now().toUtc().toIso8601String();

/// A location with an optional label/address and optional coordinates.
class HcLocation {
  final String label;
  final String address;
  final double? lat;
  final double? lng;

  const HcLocation({
    this.label = '',
    this.address = '',
    this.lat,
    this.lng,
  });

  bool get hasCoords => lat != null && lng != null;

  Map<String, dynamic> toMap() => {
        'label': label,
        'address': address,
        'lat': lat,
        'lng': lng,
      };

  factory HcLocation.fromMap(Map<String, dynamic> m) => HcLocation(
        label: (m['label'] ?? '') as String,
        address: (m['address'] ?? '') as String,
        lat: (m['lat'] as num?)?.toDouble(),
        lng: (m['lng'] as num?)?.toDouble(),
      );
}

/// Client — sensitive PII; only surfaced in the Admin app.
class Client {
  final String id;
  final String role;
  final String name;
  final String phone;
  final String email;
  final List<HcLocation> savedLocations;
  final String? accessCode;
  final String? fcmToken;
  final String createdAt;
  final String updatedAt;

  Client({
    required this.id,
    this.role = Role.client,
    required this.name,
    required this.phone,
    this.email = '',
    this.savedLocations = const [],
    this.accessCode,
    this.fcmToken,
    String? createdAt,
    String? updatedAt,
  })  : createdAt = createdAt ?? nowIso(),
        updatedAt = updatedAt ?? nowIso();

  Map<String, dynamic> toMap() => {
        'id': id,
        'role': role,
        'name': name,
        'phone': phone,
        'email': email,
        'savedLocations': savedLocations.map((l) => l.toMap()).toList(),
        'accessCode': accessCode,
        'fcmToken': fcmToken,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  factory Client.fromMap(Map<String, dynamic> m) => Client(
        id: m['id'] as String,
        role: (m['role'] ?? Role.client) as String,
        name: (m['name'] ?? '') as String,
        phone: (m['phone'] ?? '') as String,
        email: (m['email'] ?? '') as String,
        savedLocations: ((m['savedLocations'] ?? []) as List)
            .map((e) => HcLocation.fromMap(Map<String, dynamic>.from(e)))
            .toList(),
        accessCode: m['accessCode'] as String?,
        fcmToken: m['fcmToken'] as String?,
        createdAt: m['createdAt'] as String?,
        updatedAt: m['updatedAt'] as String?,
      );

  Client copyWith({
    String? name,
    String? phone,
    String? email,
    List<HcLocation>? savedLocations,
    String? accessCode,
    String? fcmToken,
  }) =>
      Client(
        id: id,
        role: role,
        name: name ?? this.name,
        phone: phone ?? this.phone,
        email: email ?? this.email,
        savedLocations: savedLocations ?? this.savedLocations,
        accessCode: accessCode ?? this.accessCode,
        fcmToken: fcmToken ?? this.fcmToken,
        createdAt: createdAt,
        updatedAt: nowIso(),
      );
}

/// Caregiver — public-facing profile.
class Caregiver {
  final String id;
  final String role;
  final String name;
  final String phone;
  final List<String> specialities;
  final String availability;
  final double rating;
  final int ratingCount;
  final HcLocation? location;          // live/last-seen GPS (gps match)
  final HcLocation? operatingLocation; // registered service area (registered match)
  final String status;                 // registered | active | rejected
  final String? accessCode;
  final String? fcmToken;
  final String? photo;       // data-URL / base64 thumbnail (identity proof)
  final String createdAt;
  final String updatedAt;

  Caregiver({
    required this.id,
    this.role = Role.caregiver,
    required this.name,
    required this.phone,
    this.specialities = const [],
    this.availability = Availability.unavailable,
    this.rating = 0,
    this.ratingCount = 0,
    this.location,
    this.operatingLocation,
    this.status = 'active',
    this.accessCode,
    this.fcmToken,
    this.photo,
    String? createdAt,
    String? updatedAt,
  })  : createdAt = createdAt ?? nowIso(),
        updatedAt = updatedAt ?? nowIso();

  Map<String, dynamic> toMap() => {
        'id': id,
        'role': role,
        'name': name,
        'phone': phone,
        'specialities': specialities,
        'availability': availability,
        'rating': rating,
        'ratingCount': ratingCount,
        'location': location?.toMap(),
        'operatingLocation': operatingLocation?.toMap(),
        'status': status,
        'accessCode': accessCode,
        'fcmToken': fcmToken,
        'photo': photo,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  factory Caregiver.fromMap(Map<String, dynamic> m) => Caregiver(
        id: m['id'] as String,
        role: (m['role'] ?? Role.caregiver) as String,
        name: (m['name'] ?? '') as String,
        phone: (m['phone'] ?? '') as String,
        specialities: ((m['specialities'] ?? []) as List).map((e) => e as String).toList(),
        availability: (m['availability'] ?? Availability.unavailable) as String,
        rating: ((m['rating'] ?? 0) as num).toDouble(),
        ratingCount: ((m['ratingCount'] ?? 0) as num).toInt(),
        location: m['location'] == null
            ? null
            : HcLocation.fromMap(Map<String, dynamic>.from(m['location'])),
        operatingLocation: m['operatingLocation'] == null
            ? null
            : HcLocation.fromMap(Map<String, dynamic>.from(m['operatingLocation'])),
        status: (m['status'] ?? 'active') as String,
        accessCode: m['accessCode'] as String?,
        fcmToken: m['fcmToken'] as String?,
        photo: m['photo'] as String?,
        createdAt: m['createdAt'] as String?,
        updatedAt: m['updatedAt'] as String?,
      );

  Caregiver copyWith({
    List<String>? specialities,
    String? availability,
    double? rating,
    int? ratingCount,
    HcLocation? location,
    HcLocation? operatingLocation,
    String? status,
    String? accessCode,
    String? fcmToken,
    String? photo,
  }) =>
      Caregiver(
        id: id,
        role: role,
        name: name,
        phone: phone,
        specialities: specialities ?? this.specialities,
        availability: availability ?? this.availability,
        rating: rating ?? this.rating,
        ratingCount: ratingCount ?? this.ratingCount,
        location: location ?? this.location,
        operatingLocation: operatingLocation ?? this.operatingLocation,
        status: status ?? this.status,
        accessCode: accessCode ?? this.accessCode,
        fcmToken: fcmToken ?? this.fcmToken,
        photo: photo ?? this.photo,
        createdAt: createdAt,
        updatedAt: nowIso(),
      );
}

/// Secret codes governing the booking lifecycle.
class BookingCodes {
  final String? startCode;
  final bool startVerified;
  final String? completeCode;
  final bool completeVerified;

  const BookingCodes({
    this.startCode,
    this.startVerified = false,
    this.completeCode,
    this.completeVerified = false,
  });

  Map<String, dynamic> toMap() => {
        'startCode': startCode,
        'startVerified': startVerified,
        'completeCode': completeCode,
        'completeVerified': completeVerified,
      };

  factory BookingCodes.fromMap(Map<String, dynamic> m) => BookingCodes(
        startCode: m['startCode'] as String?,
        startVerified: (m['startVerified'] ?? false) as bool,
        completeCode: m['completeCode'] as String?,
        completeVerified: (m['completeVerified'] ?? false) as bool,
      );

  BookingCodes copyWith({
    String? startCode,
    bool? startVerified,
    String? completeCode,
    bool? completeVerified,
  }) =>
      BookingCodes(
        startCode: startCode ?? this.startCode,
        startVerified: startVerified ?? this.startVerified,
        completeCode: completeCode ?? this.completeCode,
        completeVerified: completeVerified ?? this.completeVerified,
      );
}

/// Payment sub-record.
class BookingPayment {
  final String status; // unpaid | paid | released | refunded | transferred
  final String? inTxnId;
  final String? outTxnId;
  final String? paidAt;
  final String? releasedAt;
  final String? refundTxnId;
  final String? refundedAt;
  final String? transferredToBookingId;
  final String? transferredAt;
  final String? paymentFromBookingId; // where a rebook's paid status came from

  const BookingPayment({
    this.status = 'unpaid',
    this.inTxnId,
    this.outTxnId,
    this.paidAt,
    this.releasedAt,
    this.refundTxnId,
    this.refundedAt,
    this.transferredToBookingId,
    this.transferredAt,
    this.paymentFromBookingId,
  });

  Map<String, dynamic> toMap() => {
        'status': status,
        'inTxnId': inTxnId,
        'outTxnId': outTxnId,
        'paidAt': paidAt,
        'releasedAt': releasedAt,
        'refundTxnId': refundTxnId,
        'refundedAt': refundedAt,
        'transferredToBookingId': transferredToBookingId,
        'transferredAt': transferredAt,
        'paymentFromBookingId': paymentFromBookingId,
      };

  factory BookingPayment.fromMap(Map<String, dynamic> m) => BookingPayment(
        status: (m['status'] ?? 'unpaid') as String,
        inTxnId: m['inTxnId'] as String?,
        outTxnId: m['outTxnId'] as String?,
        paidAt: m['paidAt'] as String?,
        releasedAt: m['releasedAt'] as String?,
        refundTxnId: m['refundTxnId'] as String?,
        refundedAt: m['refundedAt'] as String?,
        transferredToBookingId: m['transferredToBookingId'] as String?,
        transferredAt: m['transferredAt'] as String?,
        paymentFromBookingId: m['paymentFromBookingId'] as String?,
      );

  BookingPayment copyWith({
    String? status,
    String? inTxnId,
    String? outTxnId,
    String? paidAt,
    String? releasedAt,
    String? refundTxnId,
    String? refundedAt,
    String? transferredToBookingId,
    String? transferredAt,
    String? paymentFromBookingId,
  }) =>
      BookingPayment(
        status: status ?? this.status,
        inTxnId: inTxnId ?? this.inTxnId,
        outTxnId: outTxnId ?? this.outTxnId,
        paidAt: paidAt ?? this.paidAt,
        releasedAt: releasedAt ?? this.releasedAt,
        refundTxnId: refundTxnId ?? this.refundTxnId,
        refundedAt: refundedAt ?? this.refundedAt,
        transferredToBookingId: transferredToBookingId ?? this.transferredToBookingId,
        transferredAt: transferredAt ?? this.transferredAt,
        paymentFromBookingId: paymentFromBookingId ?? this.paymentFromBookingId,
      );
}

/// A person the service is booked for.
class BookingRecipient {
  final String name;
  final String label;
  final String address;
  final double? lat;
  final double? lng;

  const BookingRecipient({
    this.name = '',
    this.label = '',
    this.address = '',
    this.lat,
    this.lng,
  });

  Map<String, dynamic> toMap() =>
      {'name': name, 'label': label, 'address': address, 'lat': lat, 'lng': lng};

  factory BookingRecipient.fromMap(Map<String, dynamic> m) => BookingRecipient(
        name: (m['name'] ?? '') as String,
        label: (m['label'] ?? '') as String,
        address: (m['address'] ?? '') as String,
        lat: (m['lat'] as num?)?.toDouble(),
        lng: (m['lng'] as num?)?.toDouble(),
      );
}

/// A payment revision entry (refund / transfer / void) recorded on cancel.
class PaymentRevision {
  final String type; // refund | transfer | void
  final double amount;
  final String? txnId;
  final String at;
  final String by; // client | admin
  final String reason;
  final String reasonCode;
  final String? toBookingId;

  const PaymentRevision({
    required this.type,
    this.amount = 0,
    this.txnId,
    required this.at,
    this.by = 'client',
    this.reason = '',
    this.reasonCode = '',
    this.toBookingId,
  });

  Map<String, dynamic> toMap() => {
        'type': type,
        'amount': amount,
        'txnId': txnId,
        'at': at,
        'by': by,
        'reason': reason,
        'reasonCode': reasonCode,
        'toBookingId': toBookingId,
      };

  factory PaymentRevision.fromMap(Map<String, dynamic> m) => PaymentRevision(
        type: (m['type'] ?? 'void') as String,
        amount: ((m['amount'] ?? 0) as num).toDouble(),
        txnId: m['txnId'] as String?,
        at: (m['at'] ?? nowIso()) as String,
        by: (m['by'] ?? 'client') as String,
        reason: (m['reason'] ?? '') as String,
        reasonCode: (m['reasonCode'] ?? '') as String,
        toBookingId: m['toBookingId'] as String?,
      );
}

/// Live tracking of the caregiver while en route.
class BookingTracking {
  final double? lat;
  final double? lng;
  final String? updatedAt;
  final int? etaMinutes;

  const BookingTracking({this.lat, this.lng, this.updatedAt, this.etaMinutes});

  Map<String, dynamic> toMap() => {
        'lat': lat,
        'lng': lng,
        'updatedAt': updatedAt,
        'etaMinutes': etaMinutes,
      };

  factory BookingTracking.fromMap(Map<String, dynamic> m) => BookingTracking(
        lat: (m['lat'] as num?)?.toDouble(),
        lng: (m['lng'] as num?)?.toDouble(),
        updatedAt: m['updatedAt'] as String?,
        etaMinutes: (m['etaMinutes'] as num?)?.toInt(),
      );
}

/// Client rating + comments.
class BookingFeedback {
  final int? stars;
  final String comments;
  final String? at;

  const BookingFeedback({this.stars, this.comments = '', this.at});

  Map<String, dynamic> toMap() => {'stars': stars, 'comments': comments, 'at': at};

  factory BookingFeedback.fromMap(Map<String, dynamic> m) => BookingFeedback(
        stars: (m['stars'] as num?)?.toInt(),
        comments: (m['comments'] ?? '') as String,
        at: m['at'] as String?,
      );
}

/// The central booking record every app reads/writes.
class Booking {
  final String id;
  final String clientId;
  final String? caregiverId;
  final String? caregiverName;
  final String speciality;
  final String? serviceId;
  final double? commissionPct; // per-service commission snapshot at booking time
  final String? scheduledAt;   // ISO datetime the service is needed
  final List<BookingRecipient> recipients;
  final double? unitPrice;      // per-recipient service cost
  final bool priority;          // expedited booking (differentiator)
  final String? clonedFrom;     // originating cancelled booking id, if a clone
  final List<String> invitedCaregiverIds; // admin high-precedence targeted invite
  final HcLocation location;
  final double? radiusKm;
  final double price;
  final String status;
  final BookingCodes codes;
  final BookingPayment payment;
  final List<PaymentRevision> paymentRevisions;
  final BookingTracking tracking;
  final BookingFeedback feedback;
  final List<Map<String, dynamic>> history;
  final String? cancelReason;
  final String? cancelReasonCode;
  final String? cancelledBy;
  final String? serviceStartedAt;
  final String? serviceEndedAt;
  final String createdAt;
  final String updatedAt;

  Booking({
    required this.id,
    required this.clientId,
    this.caregiverId,
    this.caregiverName,
    required this.speciality,
    this.serviceId,
    this.commissionPct,
    this.scheduledAt,
    this.recipients = const [],
    this.unitPrice,
    this.priority = false,
    this.clonedFrom,
    this.invitedCaregiverIds = const [],
    required this.location,
    this.radiusKm,
    required this.price,
    this.status = BookingStatus.created,
    this.codes = const BookingCodes(),
    this.payment = const BookingPayment(),
    this.paymentRevisions = const [],
    this.tracking = const BookingTracking(),
    this.feedback = const BookingFeedback(),
    List<Map<String, dynamic>>? history,
    this.cancelReason,
    this.cancelReasonCode,
    this.cancelledBy,
    this.serviceStartedAt,
    this.serviceEndedAt,
    String? createdAt,
    String? updatedAt,
  })  : history = history ?? [{'status': BookingStatus.created, 'at': nowIso()}],
        createdAt = createdAt ?? nowIso(),
        updatedAt = updatedAt ?? nowIso();

  bool get isActive => !kTerminalStatuses.contains(status);

  Map<String, dynamic> toMap() => {
        'id': id,
        'clientId': clientId,
        'caregiverId': caregiverId,
        'caregiverName': caregiverName,
        'speciality': speciality,
        'serviceId': serviceId,
        'commissionPct': commissionPct,
        'scheduledAt': scheduledAt,
        'recipients': recipients.map((r) => r.toMap()).toList(),
        'unitPrice': unitPrice,
        'priority': priority,
        'clonedFrom': clonedFrom,
        'invitedCaregiverIds': invitedCaregiverIds,
        'location': location.toMap(),
        'radiusKm': radiusKm,
        'price': price,
        'status': status,
        'codes': codes.toMap(),
        'payment': payment.toMap(),
        'paymentRevisions': paymentRevisions.map((r) => r.toMap()).toList(),
        'tracking': tracking.toMap(),
        'feedback': feedback.toMap(),
        'history': history,
        'cancelReason': cancelReason,
        'cancelReasonCode': cancelReasonCode,
        'cancelledBy': cancelledBy,
        'serviceStartedAt': serviceStartedAt,
        'serviceEndedAt': serviceEndedAt,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  factory Booking.fromMap(Map<String, dynamic> m) => Booking(
        id: m['id'] as String,
        clientId: m['clientId'] as String,
        caregiverId: m['caregiverId'] as String?,
        caregiverName: m['caregiverName'] as String?,
        speciality: (m['speciality'] ?? '') as String,
        serviceId: m['serviceId'] as String?,
        commissionPct: (m['commissionPct'] as num?)?.toDouble(),
        scheduledAt: m['scheduledAt'] as String?,
        recipients: ((m['recipients'] ?? []) as List)
            .map((e) => BookingRecipient.fromMap(Map<String, dynamic>.from(e)))
            .toList(),
        unitPrice: (m['unitPrice'] as num?)?.toDouble(),
        priority: (m['priority'] ?? false) as bool,
        clonedFrom: m['clonedFrom'] as String?,
        invitedCaregiverIds:
            ((m['invitedCaregiverIds'] ?? []) as List).map((e) => e as String).toList(),
        location: HcLocation.fromMap(Map<String, dynamic>.from(m['location'] ?? {})),
        radiusKm: (m['radiusKm'] as num?)?.toDouble(),
        price: ((m['price'] ?? 0) as num).toDouble(),
        status: (m['status'] ?? BookingStatus.created) as String,
        codes: BookingCodes.fromMap(Map<String, dynamic>.from(m['codes'] ?? {})),
        payment: BookingPayment.fromMap(Map<String, dynamic>.from(m['payment'] ?? {})),
        paymentRevisions: ((m['paymentRevisions'] ?? []) as List)
            .map((e) => PaymentRevision.fromMap(Map<String, dynamic>.from(e)))
            .toList(),
        tracking: BookingTracking.fromMap(Map<String, dynamic>.from(m['tracking'] ?? {})),
        feedback: BookingFeedback.fromMap(Map<String, dynamic>.from(m['feedback'] ?? {})),
        history: ((m['history'] ?? []) as List)
            .map((e) => Map<String, dynamic>.from(e))
            .toList(),
        cancelReason: m['cancelReason'] as String?,
        cancelReasonCode: m['cancelReasonCode'] as String?,
        cancelledBy: m['cancelledBy'] as String?,
        serviceStartedAt: m['serviceStartedAt'] as String?,
        serviceEndedAt: m['serviceEndedAt'] as String?,
        createdAt: m['createdAt'] as String?,
        updatedAt: m['updatedAt'] as String?,
      );

  Booking copyWith({
    String? caregiverId,
    String? caregiverName,
    String? scheduledAt,
    List<String>? invitedCaregiverIds,
    String? status,
    BookingCodes? codes,
    BookingPayment? payment,
    List<PaymentRevision>? paymentRevisions,
    BookingTracking? tracking,
    BookingFeedback? feedback,
    List<Map<String, dynamic>>? history,
    String? cancelReason,
    String? cancelReasonCode,
    String? cancelledBy,
    String? serviceStartedAt,
    String? serviceEndedAt,
  }) =>
      Booking(
        id: id,
        clientId: clientId,
        caregiverId: caregiverId ?? this.caregiverId,
        caregiverName: caregiverName ?? this.caregiverName,
        speciality: speciality,
        serviceId: serviceId,
        commissionPct: commissionPct,
        scheduledAt: scheduledAt ?? this.scheduledAt,
        recipients: recipients,
        unitPrice: unitPrice,
        priority: priority,
        clonedFrom: clonedFrom,
        invitedCaregiverIds: invitedCaregiverIds ?? this.invitedCaregiverIds,
        location: location,
        radiusKm: radiusKm,
        price: price,
        status: status ?? this.status,
        codes: codes ?? this.codes,
        payment: payment ?? this.payment,
        paymentRevisions: paymentRevisions ?? this.paymentRevisions,
        tracking: tracking ?? this.tracking,
        feedback: feedback ?? this.feedback,
        history: history ?? this.history,
        cancelReason: cancelReason ?? this.cancelReason,
        cancelReasonCode: cancelReasonCode ?? this.cancelReasonCode,
        cancelledBy: cancelledBy ?? this.cancelledBy,
        serviceStartedAt: serviceStartedAt ?? this.serviceStartedAt,
        serviceEndedAt: serviceEndedAt ?? this.serviceEndedAt,
        createdAt: createdAt,
        updatedAt: nowIso(),
      );
}

/// Platform-wide admin settings (Firestore settings/app doc).
class AppSettings {
  final bool locationVerification;
  final double verifyRadiusMeters;
  final int bookingLeadHours;
  final String priorityMode;       // multiplier | percent | flat
  final double priorityValue;
  final String matchLocationMode;  // gps | registered | both
  final List<String> cancelReasons;
  final int startAlertMinutes;

  const AppSettings({
    this.locationVerification = false,
    this.verifyRadiusMeters = 50,
    this.bookingLeadHours = 4,
    this.priorityMode = PriorityMode.multiplier,
    this.priorityValue = 1.5,
    this.matchLocationMode = MatchLocationMode.gps,
    this.cancelReasons = const [
      'No Show of Caregiver',
      'Client requested',
      'Priority changes',
    ],
    this.startAlertMinutes = 30,
  });

  Map<String, dynamic> toMap() => {
        'locationVerification': locationVerification,
        'verifyRadiusMeters': verifyRadiusMeters,
        'bookingLeadHours': bookingLeadHours,
        'priorityMode': priorityMode,
        'priorityValue': priorityValue,
        'matchLocationMode': matchLocationMode,
        'cancelReasons': cancelReasons,
        'startAlertMinutes': startAlertMinutes,
      };

  factory AppSettings.fromMap(Map<String, dynamic>? m) => AppSettings(
        locationVerification: (m?['locationVerification'] ?? false) as bool,
        verifyRadiusMeters: ((m?['verifyRadiusMeters'] ?? 50) as num).toDouble(),
        bookingLeadHours: ((m?['bookingLeadHours'] ?? 4) as num).toInt(),
        priorityMode: (m?['priorityMode'] ?? PriorityMode.multiplier) as String,
        priorityValue: ((m?['priorityValue'] ?? 1.5) as num).toDouble(),
        matchLocationMode: (m?['matchLocationMode'] ?? MatchLocationMode.gps) as String,
        cancelReasons: ((m?['cancelReasons'] ??
                const ['No Show of Caregiver', 'Client requested', 'Priority changes'])
            as List)
            .map((e) => e as String)
            .toList(),
        startAlertMinutes: ((m?['startAlertMinutes'] ?? 30) as num).toInt(),
      );

  AppSettings copyWith({
    bool? locationVerification,
    double? verifyRadiusMeters,
    int? bookingLeadHours,
    String? priorityMode,
    double? priorityValue,
    String? matchLocationMode,
    List<String>? cancelReasons,
    int? startAlertMinutes,
  }) =>
      AppSettings(
        locationVerification: locationVerification ?? this.locationVerification,
        verifyRadiusMeters: verifyRadiusMeters ?? this.verifyRadiusMeters,
        bookingLeadHours: bookingLeadHours ?? this.bookingLeadHours,
        priorityMode: priorityMode ?? this.priorityMode,
        priorityValue: priorityValue ?? this.priorityValue,
        matchLocationMode: matchLocationMode ?? this.matchLocationMode,
        cancelReasons: cancelReasons ?? this.cancelReasons,
        startAlertMinutes: startAlertMinutes ?? this.startAlertMinutes,
      );

  /// Compute the priority price for a base amount + recipient count.
  static double priorityPrice(double base, int recipients, AppSettings s) {
    final val = s.priorityValue;
    switch (s.priorityMode) {
      case PriorityMode.flat:
        return (base + val * (recipients < 1 ? 1 : recipients)).roundToDouble();
      case PriorityMode.percent:
        return (base * (1 + val / 100)).roundToDouble();
      case PriorityMode.multiplier:
      default:
        return (base * (val == 0 ? 1 : val)).roundToDouble();
    }
  }
}

/// A service in the admin-managed Services master (Firestore services collection).
class Service {
  final String id;
  final String name;
  final String key;          // stored on bookings as `speciality`
  final double cost;
  final double commissionPct; // e.g. 15
  final bool active;
  final String createdAt;
  final String updatedAt;

  Service({
    required this.id,
    required this.name,
    required this.key,
    this.cost = 0,
    this.commissionPct = 15,
    this.active = true,
    String? createdAt,
    String? updatedAt,
  })  : createdAt = createdAt ?? nowIso(),
        updatedAt = updatedAt ?? nowIso();

  Map<String, dynamic> toMap() => {
        'id': id,
        'name': name,
        'key': key,
        'cost': cost,
        'commissionPct': commissionPct,
        'active': active,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  factory Service.fromMap(Map<String, dynamic> m) => Service(
        id: m['id'] as String,
        name: (m['name'] ?? '') as String,
        key: (m['key'] ?? '') as String,
        cost: ((m['cost'] ?? 0) as num).toDouble(),
        commissionPct: ((m['commissionPct'] ?? 15) as num).toDouble(),
        active: (m['active'] ?? true) as bool,
        createdAt: m['createdAt'] as String?,
        updatedAt: m['updatedAt'] as String?,
      );

  Service copyWith({String? name, double? cost, double? commissionPct, bool? active}) => Service(
        id: id,
        name: name ?? this.name,
        key: key,
        cost: cost ?? this.cost,
        commissionPct: commissionPct ?? this.commissionPct,
        active: active ?? this.active,
        createdAt: createdAt,
        updatedAt: nowIso(),
      );
}
