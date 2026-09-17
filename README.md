RIVALS // ARENA HUB

A fan-made Roblox Rivals inspired player hub built as a single-page HTML web experiment. The site focuses on a competitive arena/lobby look, player profile generation, a dashboard, a community leaderboard, and timed XP features.

What the website does

Lets a player enter a username, rank, level, win streak, hours played, favourite mode, favourite map, and playstyle.

Generates a local player profile and updates the dashboard from the values entered.

Calculates a simple profile score and XP progress from the entered profile values.

Uses a black-hole animation to consume the Player Setup terminal after player generation.

The hero BUILD MY PLAYER button is also pulled into the black hole when the setup is consumed.

Includes a community leaderboard backed by Supabase. The leaderboard unlocks after at least 6 profiles are available.

Includes a timed XP claim system with five claims in a 60-minute cycle.

Uses animated information panels with a high-tech dropdown/opening effect.

Visual design

The site uses a dark futuristic HUD style with neon accents, glowing panels, grid/noise overlays, animated status elements, high-tech dashboard stat cards, and responsive layouts for smaller screens.

The main RIVALS logo uses the original styling from the earlier version of the site.

Tech used

HTML5

CSS3

Vanilla JavaScript

Canvas background animation

Local Storage

Supabase JavaScript client

Responsive CSS Grid

Files

index.html
README.md

Everything is currently kept in one HTML file so the project is easy to edit and publish.

Supabase setup

The community system uses a Supabase project. In index.html, set:

const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";

Use the project's normal browser-safe publishable/anon key. Do not put a Supabase service_role key into the frontend.

The site reads and inserts rows from the rivals_profiles table. The profile data used by the site includes:

device_id
username
rank
level
streak
hours
mode
map
playstyle
created_at

Player generation flow

The player fills in the setup form.

The profile is saved locally.

The dashboard is updated.

The setup terminal is disabled and consumed by the black-hole animation.

The hero BUILD MY PLAYER button is pulled into the same black hole effect and disappears.

The shared profile is sent to Supabase when the community backend is configured.

Community leaderboard

The leaderboard stays locked until 6 profiles exist. Once unlocked, the site sorts profiles by rank, then level, then win streak and displays the top 10 results.

XP system

The timed XP system has five claim stages:

Claim 1: 0 min
Claim 2: 15 min
Claim 3: 30 min
Claim 4: 45 min
Claim 5: 60 min
Then the cycle resets.

XP only activates after the community reaches the required profile count.

Local storage

The browser stores the current player, a generated device ID, profile-created state, and the timed XP state using localStorage.

Important limitation

This is a fan-made interface. It does not connect to Roblox servers or retrieve live Roblox player statistics. The profile dashboard shows information entered by the player, while the site's score and XP values are calculated locally.

Publishing

The project can be published as a normal static HTML site on a static hosting service. Upload index.html and make sure the Supabase configuration is set before using the community features.

Credits

Concept, player ideas, creative direction and testing: Prateek

Coding, interface design and systems logic: ChatGPT
