import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/themes.css'
import './styles/base.css'
import './styles/glass.css'

const node = document.getElementById('root')
if (!node) {
  throw new Error('找不到 #root 挂载点')
}

createRoot(node).render(<App />)
