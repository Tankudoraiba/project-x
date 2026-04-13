import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';

export default function App() {
  const onDrop = useCallback(async acceptedFiles => {
    const form = new FormData();
    for (const f of acceptedFiles) form.append('files', f, f.name);
    const res = await axios.post('/api/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    alert(JSON.stringify(res.data));
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div style={{ padding: 20 }}>
      <h1>project-x</h1>
      <div {...getRootProps()} style={{ border: '2px dashed #999', padding: 40 }}>
        <input {...getInputProps()} />
        {isDragActive ? <p>Drop files here...</p> : <p>Drag & drop files, or click to select files</p>}
      </div>
    </div>
  );
}
