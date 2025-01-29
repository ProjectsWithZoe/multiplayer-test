/*
  # Update games table policies

  1. Changes
    - Drop existing policies
    - Recreate policies with updated logic for multiplayer support
  2. Security
    - Maintain RLS on games table
    - Update policies for better multiplayer game flow
    - Allow viewing of open games
    - Allow joining games as player2
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their games" ON games;
DROP POLICY IF EXISTS "Users can create games" ON games;
DROP POLICY IF EXISTS "Players can update games on their turn" ON games;

-- Recreate policies with updated logic
CREATE POLICY "Users can view their games"
  ON games
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = player1 OR 
    auth.uid() = player2 OR
    (player2 IS NULL AND NOT game_over)  -- Allow viewing open games
  );

CREATE POLICY "Users can create games"
  ON games
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = player1 AND
    auth.uid() = current_player AND
    player2 IS NULL
  );

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