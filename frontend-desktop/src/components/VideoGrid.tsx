import { useState, useRef, useEffect, useCallback } from 'react';
import type { RemoteStreamInfo } from '../useWebRTC';
import { BsMicMuteFill } from 'react-icons/bs';
import { KuiAvatar } from './KuiAvatar';
import './VideoGrid.css';

interface VideoGridProps {
    localStream: MediaStream | null;
    remoteStreams: RemoteStreamInfo[];
    isCamOff: boolean;
    isMuted: boolean;
    isScreenSharing: boolean;
    userName: string;
}

interface StreamEntry {
    id: string;
    stream: MediaStream | null;
    label: string;
    isLocal: boolean;
    isCamOff: boolean;
    isMuted: boolean;
    isScreenSharing: boolean;
}

// ═══════ VideoTile ═══════

function VideoTile({
    entry,
    isFocused,
    onFocus,
    onUnfocus,
    isInStrip,
}: {
    entry: StreamEntry;
    isFocused: boolean;
    onFocus: () => void;
    onUnfocus: () => void;
    isInStrip: boolean;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (videoRef.current && entry.stream) {
            videoRef.current.srcObject = entry.stream;
        }
    }, [entry.stream]);

    const showVideo = entry.stream && !entry.isCamOff;
    const viewClass = entry.isScreenSharing ? 'screen-share-view' : 'webcam-view';

    return (
        <div
            className={`video-tile ${isFocused ? 'video-tile--active' : ''} ${viewClass}`}
            onClick={isFocused ? onUnfocus : onFocus}
        >
            {/* Focus/Unfocus button */}
            <button
                className="video-tile__focus-btn"
                onClick={(e) => {
                    e.stopPropagation();
                    isFocused ? onUnfocus() : onFocus();
                }}
                title={isFocused ? 'Sair do foco' : 'Focar'}
            >
                {isFocused ? '✕' : '⤢'}
            </button>

            {/* Live badge for screen sharing */}
            {entry.isScreenSharing && (
                <div className="live-badge">
                    <div className="live-badge__dot" />
                    <span className="live-badge__text">Ao Vivo</span>
                </div>
            )}

            {/* Video or Avatar */}
            {showVideo ? (
                <video
                    ref={videoRef}
                    autoPlay
                    muted={entry.isLocal}
                    playsInline
                    className={viewClass}
                />
            ) : (
                <div className="video-tile__avatar-container">
                    <KuiAvatar
                        size={isInStrip ? 56 : 88}
                        userId={entry.id || entry.label}
                    />
                    {entry.isCamOff && (
                        <span className="video-tile__cam-off-label">Câmera desligada</span>
                    )}
                </div>
            )}

            {/* Name badge */}
            <div className="video-tile__badge">
                {entry.isMuted && <BsMicMuteFill className="video-tile__badge-icon" />}
                <span className="video-tile__badge-name">
                    {entry.label}{entry.isLocal ? ' (Você)' : ''}
                </span>
            </div>
        </div>
    );
}

// ═══════ VideoGrid ═══════

export function VideoGrid({
    localStream,
    remoteStreams,
    isCamOff,
    isMuted,
    isScreenSharing,
    userName,
}: VideoGridProps) {
    const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null);

    // Build unified stream list: local + remotes
    const allStreams: StreamEntry[] = [
        {
            id: 'local',
            stream: localStream,
            label: userName,
            isLocal: true,
            isCamOff,
            isMuted,
            isScreenSharing,
        },
        ...remoteStreams.map(rs => ({
            id: rs.peerId,
            stream: rs.stream,
            label: rs.peerId.slice(0, 8),
            isLocal: false,
            isCamOff: false, // We can't know remote cam state without data channel
            isMuted: false,
            isScreenSharing: rs.isScreenSharing,
        })),
    ];

    // Auto-focus screen shares
    const handleFocus = useCallback((id: string) => {
        setFocusedStreamId(id);
    }, []);

    const handleUnfocus = useCallback(() => {
        setFocusedStreamId(null);
    }, []);

    // Auto-detect screen share and focus it
    useEffect(() => {
        const screenShareStream = allStreams.find(s => s.isScreenSharing && !s.isLocal);
        if (screenShareStream && !focusedStreamId) {
            setFocusedStreamId(screenShareStream.id);
        }
    }, [remoteStreams]); // eslint-disable-line react-hooks/exhaustive-deps

    // If focused stream no longer exists, clear focus
    useEffect(() => {
        if (focusedStreamId && !allStreams.find(s => s.id === focusedStreamId)) {
            setFocusedStreamId(null);
        }
    }, [allStreams, focusedStreamId]);

    const focusedEntry = focusedStreamId ? allStreams.find(s => s.id === focusedStreamId) : null;
    const otherEntries = focusedStreamId ? allStreams.filter(s => s.id !== focusedStreamId) : allStreams;

    // ── Focus Mode ──
    if (focusedEntry) {
        return (
            <div className="video-grid-container">
                <div className="video-grid--focused">
                    <div className="video-focused-main">
                        <VideoTile
                            entry={focusedEntry}
                            isFocused={true}
                            onFocus={() => {}}
                            onUnfocus={handleUnfocus}
                            isInStrip={false}
                        />
                    </div>
                    {otherEntries.length > 0 && (
                        <div className="video-strip">
                            {otherEntries.map(entry => (
                                <VideoTile
                                    key={entry.id}
                                    entry={entry}
                                    isFocused={false}
                                    onFocus={() => handleFocus(entry.id)}
                                    onUnfocus={handleUnfocus}
                                    isInStrip={true}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Normal Grid Mode ──
    const gridClass = allStreams.length <= 1 ? 'video-grid video-grid--single' : 'video-grid';

    return (
        <div className="video-grid-container">
            <div className={gridClass}>
                {allStreams.map(entry => (
                    <VideoTile
                        key={entry.id}
                        entry={entry}
                        isFocused={false}
                        onFocus={() => handleFocus(entry.id)}
                        onUnfocus={handleUnfocus}
                        isInStrip={false}
                    />
                ))}
            </div>
        </div>
    );
}
