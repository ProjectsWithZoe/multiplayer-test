import React, { useEffect, useState } from 'react';
import { Minus, Plus, LogIn, LogOut } from 'lucide-react';
import { supabase } from './lib/supabase';
import toast, { Toaster } from 'react-hot-toast';
import { RealtimeChannel } from '@supabase/supabase-js';

type Game = {
  id: string;
  current_number: number;
  current_player: string;
  players: string[];  // Array of player IDs
  game_over: boolean;
  winner: string | null;
};

const REALTIME_POSTGRES_CHANGES_LISTEN_EVENT = 'postgres_changes';

function App() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [availableGames, setAvailableGames] = useState<Game[]>([]);
  const [gameCode, setGameCode] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user) {
      fetchGameState();
    }
  }, [session]);

  useEffect(() => {
    if (!game?.id || !session?.user?.id) return;

    console.log('Setting up realtime subscription for game:', game.id);

    const channel = supabase.channel('game_updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${game.id}`,
        },
        (payload) => {
          console.log('Received realtime update:', payload);
          const newGame = payload.new as Game;
          setGame(newGame);
        }
      )
      .subscribe(async (status) => {
        console.log('Realtime subscription status:', status);
        
        if (status === 'SUBSCRIBED') {
          // Fetch latest game state when subscription is established
          const { data } = await supabase
            .from('games')
            .select('*')
            .eq('id', game.id)
            .single();
          
          if (data) {
            console.log('Initial game state:', data);
            setGame(data);
          }
        }
      });

    return () => {
      console.log('Cleaning up realtime subscription');
      supabase.removeChannel(channel);
    };
  }, [game?.id, session?.user?.id]);

  const fetchGameState = async () => {
    if (!session?.user?.id) return;

    // First check if user is in any active game
    const { data: userGames, error: gamesError } = await supabase
      .from('games')
      .select('*')
      .contains('players', [session.user.id])
      .not('game_over', 'is', true)
      .limit(1);

    if (gamesError) {
      toast.error('Error fetching games');
      return;
    }

    if (userGames && userGames.length > 0) {
      setGame(userGames[0]);
      return;
    }

    // If not in a game, fetch available games to join
    const { data: openGames, error: openGamesError } = await supabase
      .from('games')
      .select('*')
      .not('game_over', 'is', true)
      .not('players', 'cs', `{${session.user.id}}`)  // Not in games where user is already a player
      .filter('players', 'cs', '{}')  // Has players array
      .lt('players', 'length', 4);  // Less than 4 players

    if (openGamesError) {
      console.error('Error fetching open games:', openGamesError);
      toast.error('Error fetching open games');
      return;
    }

    console.log('Available games:', openGames);
    setAvailableGames(openGames || []);
  };

  const generateGameCode = () => {
    // Generate a 6-character alphanumeric code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const createNewGame = async () => {
    if (!session?.user?.id) {
      toast.error('You must be logged in to create a game');
      return;
    }

    const gameCode = generateGameCode();
    console.log('Generated game code:', gameCode); // Debug log

    try {
      const { data: newGame, error } = await supabase
        .from('games')
        .insert({
          id: gameCode,
          current_number: 0,
          current_player: session.user.id,
          players: [session.user.id],
          game_over: false,
          winner: null
        })
        .select()
        .single();

      if (error) {
        console.error('Create game error:', error);
        toast.error('Error creating game');
        return;
      }

      console.log('Created new game:', newGame);
      setGame(newGame);
    } catch (error) {
      console.error('Create game error:', error);
      toast.error('Error creating game');
    }
  };

  const joinGame = async (gameId: string) => {
    // First, verify the game is available
    const { data: gameCheck } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single();

    if (!gameCheck) {
      toast.error('Game not found');
      return;
    }

    if (gameCheck.players.includes(session.user.id)) {
      toast.error('You are already in this game');
      return;
    }

    const { error } = await supabase
      .from('games')
      .update({ 
        players: [...gameCheck.players, session.user.id],
        updated_at: new Date().toISOString()
      })
      .eq('id', gameId);

    if (error) {
      console.error('Join game error:', error);
      toast.error(`Error joining game: ${error.message}`);
      return;
    }

    await fetchGameState();
  };

  const handleMove = async (increment: boolean) => {
    if (!game || !session?.user?.id) {
      console.log('No game or session');
      return;
    }
    
    if (game.current_player !== session.user.id) {
      toast.error("It's not your turn!");
      return;
    }

    const newNumber = increment ? game.current_number + 1 : game.current_number - 1;
    console.log('Attempting move:', { 
      gameId: game.id,
      currentNumber: game.current_number,
      newNumber,
      increment 
    });
    
    const currentPlayerIndex = game.players.indexOf(game.current_player);
    const nextPlayerIndex = (currentPlayerIndex + 1) % game.players.length;
    const nextPlayer = game.players[nextPlayerIndex];

    try {
      const { data, error } = await supabase
        .from('games')
        .update({
          current_number: newNumber,
          current_player: nextPlayer,
          updated_at: new Date().toISOString()
        })
        .eq('id', game.id)
        .select()
        .single();

      if (error) {
        console.error('Move error:', error);
        toast.error('Error making move');
        return;
      }

      console.log('Move successful, server returned:', data);
      
      // Optimistically update local state
      if (data) {
        setGame(data);
      }
    } catch (error) {
      console.error('Move error:', error);
      toast.error('Error making move');
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) toast.error(error.message);
    else toast.success('Check your email to confirm your account!');
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) toast.error(error.message);
    else toast.success('Signed in successfully!');
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setGame(null);
    setAvailableGames([]);
  };

  const getPlayerRole = (playerId?: string) => {
    if (!game) return null;
    const playerToCheck = playerId || session?.user?.id;
    if (!playerToCheck) return null;
    
    const playerIndex = game.players.indexOf(playerToCheck);
    if (playerIndex === -1) return 'Spectator';
    return `Player ${playerIndex + 1}`;
  };

  const joinGameByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gameCode.trim() || !session?.user?.id) return;

    const { data: gameCheck, error: checkError } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameCode)
      .single();

    if (checkError || !gameCheck) {
      toast.error('Game not found');
      return;
    }

    if (gameCheck.players.includes(session.user.id)) {
      toast.error('You are already in this game');
      return;
    }

    const { error } = await supabase
      .from('games')
      .update({ 
        players: [...gameCheck.players, session.user.id],
        updated_at: new Date().toISOString()
      })
      .eq('id', gameCode)
      .select()
      .single();

    if (error) {
      console.error('Join game error:', error);
      toast.error(`Error joining game: ${error.message}`);
      return;
    }

    setGameCode('');
    fetchGameState();
  };

  // Add this debug effect
  useEffect(() => {
    if (game) {
      console.log('Game state updated:', {
        id: game.id,
        number: game.current_number,
        currentPlayer: game.current_player,
        players: game.players
      });
    }
  }, [game]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <p className="text-lg">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md w-96">
          <h1 className="text-2xl font-bold mb-6">Two Player Counter Game</h1>
          <form onSubmit={handleSignIn} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                required
              />
            </div>
            <div className="flex space-x-4">
              <button
                type="submit"
                className="flex-1 bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors"
              >
                <LogIn className="inline-block w-4 h-4 mr-2" />
                Sign In
              </button>
              <button
                type="button"
                onClick={handleSignUp}
                className="flex-1 bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 transition-colors"
              >
                Sign Up
              </button>
            </div>
          </form>
        </div>
        <Toaster />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Two Player Counter Game</h1>
          <button
            onClick={handleSignOut}
            className="text-gray-600 hover:text-gray-800"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {game ? (
          <div className="space-y-6">
            <div className="text-center">
              <p className="text-4xl font-bold mb-4">{game.current_number}</p>
              <p className="text-sm text-gray-600 mb-2">
                {game.current_player === session.user.id ? (
                  "It's your turn!"
                ) : (
                  `Waiting for ${getPlayerRole(game.current_player)} to move...`
                )}
              </p>
              <p className="text-sm font-medium text-blue-600">
                You are {getPlayerRole(session.user.id)}
              </p>
              <p className="text-sm text-gray-600">
                Players in game: {Array.isArray(game.players) ? game.players.length : 0}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Current turn: {getPlayerRole(game.current_player)}
              </p>
            </div>

            <div className="flex justify-center space-x-4">
              <button
                onClick={() => handleMove(false)}
                disabled={!game || game.current_player !== session?.user?.id}
                className="bg-red-500 text-white p-3 rounded-full hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                <Minus className="w-6 h-6" />
              </button>
              <button
                onClick={() => handleMove(true)}
                disabled={!game || game.current_player !== session?.user?.id}
                className="bg-green-500 text-white p-3 rounded-full hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>

            {game.players.length < 4 && (  // Optional: limit to 4 players
              <p className="text-center text-sm text-gray-600">
                Waiting for more players to join...
              </p>
            )}

            <div className="mt-4 text-center">
              <p className="text-sm text-gray-600">Game Code:</p>
              <p className="font-mono text-lg bg-gray-100 p-2 rounded tracking-wider">
                {game.id}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <form onSubmit={joinGameByCode} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Join with Game Code
                </label>
                <div className="mt-1 flex space-x-2">
                  <input
                    type="text"
                    value={gameCode}
                    onChange={(e) => setGameCode(e.target.value)}
                    placeholder="Enter game code"
                    className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-300 focus:ring focus:ring-indigo-200 focus:ring-opacity-50"
                  />
                  <button
                    type="submit"
                    className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors"
                  >
                    Join
                  </button>
                </div>
              </div>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">or</span>
              </div>
            </div>

            {availableGames.length > 0 ? (
              <div>
                <h2 className="text-lg font-semibold mb-4">Available Games</h2>
                <div className="space-y-2">
                  {availableGames.map((availableGame) => (
                    <div key={availableGame.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                      <span className="text-sm text-gray-600">
                        Players: {availableGame.players.length}/4
                      </span>
                      <button
                        onClick={() => joinGame(availableGame.id)}
                        className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors"
                      >
                        Join Game
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <button
                onClick={createNewGame}
                className="w-full bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 transition-colors"
              >
                Create New Game
              </button>
            )}
          </div>
        )}
      </div>
      <Toaster />
    </div>
  );
}

export default App;