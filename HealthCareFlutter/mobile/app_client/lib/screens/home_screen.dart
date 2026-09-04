import 'package:flutter/material.dart';
import 'package:hc_core/hc_core.dart';

import '../services.dart';
import 'book_screen.dart';
import 'active_booking_screen.dart';

/// Routes between "book a service" and the active booking view, driven by the
/// live bookings stream so the UI reacts as the caregiver progresses.
class HomeScreen extends StatelessWidget {
  final AppServices services;
  final Client client;
  final Session session;
  const HomeScreen({super.key, required this.services, required this.client, required this.session});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Booking>>(
      stream: services.repo.bookingsStream(),
      builder: (context, snap) {
        final all = snap.data ?? const <Booking>[];
        final mine = all.where((b) => b.clientId == client.id).toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
        Booking? active;
        for (final b in mine) {
          if (b.isActive) { active = b; break; }
        }
        // also show a just-completed booking until the user books again
        active ??= mine.isNotEmpty && mine.first.status == BookingStatus.completed
            ? mine.first
            : null;

        if (active == null) {
          return BookScreen(services: services, client: client);
        }
        return ActiveBookingScreen(services: services, client: client, bookingId: active.id);
      },
    );
  }
}
