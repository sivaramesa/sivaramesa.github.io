/// Domain enums shared across the HomeCare apps.
///
/// These mirror the string values used by the PWA and stored in Firestore, so
/// both stacks read/write the same documents interchangeably.

/// User roles.
class Role {
  static const client = 'client';
  static const caregiver = 'caregiver';
  static const admin = 'admin';
}

/// Caregiver availability.
class Availability {
  static const available = 'available';
  static const unavailable = 'unavailable';
  static const onService = 'on_service';
}

/// Booking lifecycle states (order mirrors requirements 3–9).
class BookingStatus {
  static const created = 'created';
  static const paid = 'paid';
  static const broadcast = 'broadcast';
  static const accepted = 'accepted';
  static const enRoute = 'en_route';
  static const arrived = 'arrived';
  static const inService = 'in_service';
  static const completionPending = 'completion_pending';
  static const completed = 'completed';
  static const cancelled = 'cancelled';
  static const expired = 'expired';
}

/// Allowed transitions — enforced by the lifecycle service.
const Map<String, List<String>> kTransitions = {
  'created': ['paid', 'cancelled'],
  'paid': ['broadcast', 'cancelled'],
  'broadcast': ['accepted', 'expired', 'cancelled'],
  'accepted': ['en_route', 'cancelled'],
  'en_route': ['arrived', 'cancelled'],
  'arrived': ['in_service', 'cancelled'],
  'in_service': ['completion_pending', 'cancelled'],
  'completion_pending': ['completed', 'cancelled'], // admin may still cancel before completion
  'completed': [],
  'cancelled': [],
  'expired': ['broadcast', 'cancelled'], // admin can re-broadcast or cancel a lapsed request
};

/// Which caregiver location the matching uses when broadcasting/filtering.
class MatchLocationMode {
  static const gps = 'gps'; // live shared location
  static const registered = 'registered'; // profile operating location
  static const both = 'both'; // eligible if EITHER is within range (OR)
  static const all = <String>[gps, registered, both];
}

/// Priority pricing modes.
class PriorityMode {
  static const multiplier = 'multiplier';
  static const percent = 'percent';
  static const flat = 'flat';
  static const all = <String>[multiplier, percent, flat];
}

/// Specialities offered (matched against caregiver skills).
class Speciality {
  static const nursing = 'nursing';
  static const physiotherapy = 'physiotherapy';
  static const elderCare = 'elder_care';
  static const postSurgery = 'post_surgery';
  static const babyCare = 'baby_care';
  static const labSample = 'lab_sample';

  static const all = <String>[
    nursing,
    physiotherapy,
    elderCare,
    postSurgery,
    babyCare,
    labSample,
  ];
}

/// Terminal states a booking can no longer act from (for "active" filtering).
const kTerminalStatuses = <String>[
  BookingStatus.completed,
  BookingStatus.cancelled,
  BookingStatus.expired,
];

/// Seed definitions for the Services master (name, key, default cost).
/// Used once to migrate the original hardcoded specialities into Firestore.
const kServiceSeed = <Map<String, dynamic>>[
  {'key': 'nursing', 'name': 'Nursing', 'cost': 800},
  {'key': 'physiotherapy', 'name': 'Physiotherapy', 'cost': 700},
  {'key': 'elder_care', 'name': 'Elder Care', 'cost': 600},
  {'key': 'post_surgery', 'name': 'Post Surgery', 'cost': 900},
  {'key': 'baby_care', 'name': 'Baby Care', 'cost': 650},
  {'key': 'lab_sample', 'name': 'Lab Sample', 'cost': 300},
];
