import React from 'react';
import { AuthProvider, useAuth } from './AuthContext';
import AuthScreen from './components/AuthScreen';
import ChatLayout from './components/ChatLayout';

const AppInner: React.FC = () => {
  const { token } = useAuth();
  return token ? <ChatLayout /> : <AuthScreen />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
};

export default App;
