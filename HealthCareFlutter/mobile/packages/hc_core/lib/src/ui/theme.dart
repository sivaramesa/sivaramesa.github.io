import 'package:flutter/material.dart';

/// Shared theming for all three HomeCare apps: dark (default) / light mode plus
/// five accent themes. A [ChangeNotifier] so the app rebuilds on change.
///
/// Note: persistence is not wired here (no shared_preferences dependency yet);
/// selections last for the app session. Add shared_preferences later to persist.
class HcAccent {
  final String key;
  final String label;
  final Color color;
  const HcAccent(this.key, this.label, this.color);
}

const List<HcAccent> hcAccents = [
  HcAccent('blue', 'Blue', Color(0xFF2A7FFF)),
  HcAccent('teal', 'Teal', Color(0xFF14A3A3)),
  HcAccent('violet', 'Violet', Color(0xFF7C5CFF)),
  HcAccent('emerald', 'Emerald', Color(0xFF16A34A)),
  HcAccent('rose', 'Rose', Color(0xFFE0457B)),
];

class HcThemeController extends ChangeNotifier {
  ThemeMode _mode = ThemeMode.dark; // default dark
  String _accentKey = 'blue';

  ThemeMode get mode => _mode;
  String get accentKey => _accentKey;
  HcAccent get accent => hcAccents.firstWhere((a) => a.key == _accentKey, orElse: () => hcAccents.first);

  void toggleMode() {
    _mode = _mode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
  }

  void setAccent(String key) {
    if (hcAccents.any((a) => a.key == key)) {
      _accentKey = key;
      notifyListeners();
    }
  }

  ThemeData themeFor(Brightness brightness) => ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: accent.color, brightness: brightness),
        useMaterial3: true,
      );

  ThemeData get light => themeFor(Brightness.light);
  ThemeData get dark => themeFor(Brightness.dark);
}

/// A banner action that opens the theme picker (mode toggle + accent swatches).
class HcThemeButton extends StatelessWidget {
  final HcThemeController controller;
  const HcThemeButton({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Theme',
      icon: Icon(controller.mode == ThemeMode.dark ? Icons.dark_mode : Icons.light_mode),
      onPressed: () => showModalBottomSheet(
        context: context,
        builder: (c) => AnimatedBuilder(
          animation: controller,
          builder: (c, _) => Padding(
            padding: const EdgeInsets.all(16),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                const Expanded(child: Text('Appearance', style: TextStyle(fontWeight: FontWeight.bold))),
                TextButton.icon(
                  onPressed: controller.toggleMode,
                  icon: Icon(controller.mode == ThemeMode.dark ? Icons.light_mode : Icons.dark_mode),
                  label: Text(controller.mode == ThemeMode.dark ? 'Light' : 'Dark'),
                ),
              ]),
              const SizedBox(height: 8),
              Wrap(spacing: 12, children: [
                for (final a in hcAccents)
                  GestureDetector(
                    onTap: () => controller.setAccent(a.key),
                    child: CircleAvatar(
                      backgroundColor: a.color,
                      radius: 18,
                      child: controller.accentKey == a.key
                          ? const Icon(Icons.check, color: Colors.white, size: 18)
                          : null,
                    ),
                  ),
              ]),
            ]),
          ),
        ),
      ),
    );
  }
}
