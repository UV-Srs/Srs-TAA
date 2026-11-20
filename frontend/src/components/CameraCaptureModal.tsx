import React, { useState, useRef, useEffect } from 'react';
import { X, Camera, Upload, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { uploadBatchAttachment } from '../api';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  batchId: number;
  itemId?: number;
  onPhotoUploaded: () => void;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  batchId,
  itemId,
  onPhotoUploaded,
}) => {
  const [streamActive, setStreamActive] = useState<boolean>(false);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
      resetCapture();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    try {
      setErrorMsg(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setStreamActive(true);
    } catch (err: any) {
      setErrorMsg('TFT Camera not accessible. You may upload an image file directly.');
      setStreamActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStreamActive(false);
  };

  const resetCapture = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setCapturedBlob(null);
    setPreviewUrl(null);
  };

  const handleCaptureSnapshot = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          setCapturedBlob(blob);
          setPreviewUrl(URL.createObjectURL(blob));
          stopCamera();
        }
      },
      'image/jpeg',
      0.9
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('Image size exceeds 10 MB limit.');
      return;
    }

    setCapturedBlob(file);
    setPreviewUrl(URL.createObjectURL(file));
    stopCamera();
  };

  const handleSaveAttachment = async () => {
    if (!capturedBlob) return;
    try {
      setIsUploading(true);
      setErrorMsg(null);
      const source = streamActive || !fileInputRef.current?.files?.length ? 'TFT_CAMERA' : 'FILE_UPLOAD';
      await uploadBatchAttachment(batchId, capturedBlob, source, itemId);
      onPhotoUploaded();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to upload photo evidence.');
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 no-print backdrop-blur-sm">
      <div className="bg-white border-4 border-black w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="bg-black text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5" />
            <h2 className="font-extrabold text-sm uppercase tracking-wider">
              TFT Photo Evidence Capture
            </h2>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-white hover:text-zinc-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewport */}
        <div className="p-5 space-y-4">
          <div className="border-2 border-black aspect-video bg-black relative flex items-center justify-center overflow-hidden">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Captured Evidence"
                className="w-full h-full object-contain"
              />
            ) : streamActive ? (
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
            ) : (
              <div className="text-white text-center p-4">
                <Camera className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs font-mono">Camera inactive or unavailable.</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {previewUrl ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    resetCapture();
                    startCamera();
                  }}
                  className="flex-1 py-2.5 bg-white border-2 border-black text-black font-extrabold text-xs uppercase flex items-center justify-center gap-1.5 hover:bg-zinc-100"
                >
                  <RefreshCw className="w-4 h-4" />
                  Retake Photo
                </button>
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={handleSaveAttachment}
                  className="flex-1 py-2.5 bg-black text-white font-extrabold text-xs uppercase flex items-center justify-center gap-1.5 hover:bg-zinc-800 disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  {isUploading ? 'Uploading...' : 'Save Evidence'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleCaptureSnapshot}
                  disabled={!streamActive}
                  className="flex-1 py-3 bg-black text-white font-extrabold text-xs uppercase flex items-center justify-center gap-2 hover:bg-zinc-800 disabled:opacity-50"
                >
                  <Camera className="w-4 h-4" />
                  Capture Photo
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="py-3 px-4 bg-white border-2 border-black text-black font-extrabold text-xs uppercase flex items-center justify-center gap-1.5 hover:bg-zinc-100"
                >
                  <Upload className="w-4 h-4" />
                  Upload File
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </>
            )}
          </div>

          {errorMsg && (
            <div className="border border-black bg-zinc-100 p-2.5 flex items-center gap-2 text-xs font-mono text-black">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
