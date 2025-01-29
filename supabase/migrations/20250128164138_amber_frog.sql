/*
  # Update Game Policies

  1. Changes
    - Update RLS policies to properly handle game creation and joining
    - Allow viewing open games (where player2 is null)
    - Fix game creation policy
    - Allow joining open games

  2. Security
    - Maintain RLS protection while allowing proper game flow
    - Ensure players can only update games on their turn
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