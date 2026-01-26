#!/bin/bash

# yt2pdf 의존성 설치 스크립트

set -e

echo "🔧 yt2pdf 의존성 설치 시작..."
echo ""

# OS 감지
OS="$(uname -s)"

# ffmpeg 설치 확인 및 설치
check_ffmpeg() {
    if command -v ffmpeg &> /dev/null; then
        echo "✅ ffmpeg가 이미 설치되어 있습니다: $(ffmpeg -version | head -1)"
        return 0
    fi

    echo "📦 ffmpeg 설치 중..."

    case "$OS" in
        Darwin)
            if command -v brew &> /dev/null; then
                brew install ffmpeg
            else
                echo "❌ Homebrew가 필요합니다. https://brew.sh 에서 설치해주세요."
                exit 1
            fi
            ;;
        Linux)
            if command -v apt-get &> /dev/null; then
                sudo apt-get update && sudo apt-get install -y ffmpeg
            elif command -v yum &> /dev/null; then
                sudo yum install -y ffmpeg
            elif command -v pacman &> /dev/null; then
                sudo pacman -S ffmpeg
            else
                echo "❌ 패키지 관리자를 찾을 수 없습니다. ffmpeg를 수동으로 설치해주세요."
                exit 1
            fi
            ;;
        *)
            echo "❌ 지원하지 않는 OS입니다: $OS"
            exit 1
            ;;
    esac

    echo "✅ ffmpeg 설치 완료"
}

# yt-dlp 설치 확인 및 설치
check_ytdlp() {
    if command -v yt-dlp &> /dev/null; then
        echo "✅ yt-dlp가 이미 설치되어 있습니다: $(yt-dlp --version)"
        return 0
    fi

    echo "📦 yt-dlp 설치 중..."

    case "$OS" in
        Darwin)
            if command -v brew &> /dev/null; then
                brew install yt-dlp
            else
                pip3 install yt-dlp
            fi
            ;;
        Linux)
            pip3 install yt-dlp
            ;;
        *)
            echo "❌ 지원하지 않는 OS입니다: $OS"
            exit 1
            ;;
    esac

    echo "✅ yt-dlp 설치 완료"
}

# 메인 실행
echo "1️⃣ ffmpeg 확인..."
check_ffmpeg
echo ""

echo "2️⃣ yt-dlp 확인..."
check_ytdlp
echo ""

echo "3️⃣ npm 패키지 설치..."
npm install
echo ""

echo "✅ 모든 의존성 설치 완료!"
echo ""
echo "사용법:"
echo "  yt2pdf <YouTube-URL>"
echo ""
