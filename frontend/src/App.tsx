import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CustomerLogin } from './pages/Login';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CustomerLogin />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
