import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './gallery.css';
import './conveyor3d.css';
import './conveyor-walk.css';

const ModelViewer = React.lazy(()=>import('./ModelViewer.jsx'));
const isModelViewer=new URLSearchParams(window.location.search).get('scene')==='modelviewer';
createRoot(document.getElementById('root')).render(isModelViewer?<React.Suspense fallback={null}><ModelViewer/></React.Suspense>:<App />);
