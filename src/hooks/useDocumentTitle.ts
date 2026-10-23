import { useEffect } from 'react';

const useDocumentTitle = (title: string) => {
  useEffect(() => {
    document.title = `${title} | Competitive Bingo`;
  }, [title]);
};

export default useDocumentTitle;
