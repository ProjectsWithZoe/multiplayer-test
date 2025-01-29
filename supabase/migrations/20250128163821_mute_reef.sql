/*
  # Game System Schema with Updated Security Policies

  1. New Tables
    - `games`
      - `id` (uuid, primary key)
      - `current_number` (integer) - The current counter value
      - `current_player` (uuid) - Reference to the player whose turn it is
      - `player1` (uuid) - First player's ID
      - `player2` (uuid) - Second player's ID
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
      - `game_over` (boolean) - Whether the game has ended
      - `winner` (uuid) - Reference to the winning player

  2. Security
    - Enable RLS on `games` table
    - Add policies for:
      - Game creation (player1)
      - Game joining (player2)
      - Game viewing (both players)
      - Game updates (current player only)
*/

CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  current_number integer DEFAULT 0,
  current_player uuid REFERENCES auth.users(id),
  player1 uuid REFERENCES auth.users(id),
  player2 uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  game_over boolean DEFAULT false,
  winner uuid REFERENCES auth.users(id),
  CONSTRAINT valid_players CHECK (player1 != player2)
);

ALTER TABLE games ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view games they're part of
CREATE POLICY "Users can view their games"
  ON games
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = player1 OR 
    auth.uid() = player2 OR
    (player2 IS NULL AND NOT game_over)  -- Allow viewing open games
  );

-- Allow authenticated users to create new games
CREATE POLICY "Users can create games"
  ON games
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = player1 AND
    auth.uid() = current_player AND
    player2 IS NULL
  );

-- Allow players to update games on their turn
CREATE POLICY "Players can update games on their turn"
  ON games
  FOR UPDATE
  TO authenticated
  USING (
    (
      auth.uid() = current_player AND 
      NOT game_over
    ) OR
    (
      player2 IS NULL AND
      auth.uid() != player1 AND
      NOT game_over
    )
  );