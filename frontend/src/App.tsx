import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CustomerLogin } from './pages/Login';
import { Welcome } from './pages/Welcome';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CustomerLogin />} />
        <Route path="/welcome" element={<Welcome />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
