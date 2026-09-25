import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ChakraProvider, extendTheme, ColorModeScript } from '@chakra-ui/react';
import { ErrorBoundary } from './components/ErrorBoundary';

const darkTheme = extendTheme({
  config: {
    initialColorMode: 'dark',
    useSystemColorMode: false,
  },
  styles: {
    global: {
      body: {
        bg: 'gray.900',
        color: 'white',
      },
    },
  },
  components: {
    Input: {
      defaultProps: {
        focusBorderColor: 'blue.500',
      },
      baseStyle: {
        field: {
          color: 'white',
          _placeholder: {
            color: 'gray.400',
          },
        },
      },
    },
    Textarea: {
      defaultProps: {
        focusBorderColor: 'blue.500',
      },
      baseStyle: {
        color: 'white',
        _placeholder: {
          color: 'gray.400',
        },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ColorModeScript initialColorMode={darkTheme.config.initialColorMode} />
    <ChakraProvider theme={darkTheme}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ChakraProvider>
  </React.StrictMode>
);
